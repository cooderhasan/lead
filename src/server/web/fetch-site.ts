import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import * as cheerio from "cheerio";
import { isPrivateAddress, normalizeUrl, registrableHost } from "./ssrf";

export const USER_AGENT = "AISalesOS-SiteAnalyzer/1.0 (+company-profile-analysis)";
const MAX_BYTES = 2_000_000;
const MAX_TEXT_PER_PAGE = 15_000;

export interface FetchOptions {
  /** Yalnızca testler için: yerel test sunucusuna izin verir. */
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
}

export interface PageContent {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  text: string;
  links: string[];
  emails: string[];
  phones: string[];
}

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

/**
 * DNS çözümlemesini bağlantı anında doğrulayan agent — DNS rebinding ile iç ağa erişimi engeller.
 */
function safeAgent(allowPrivate: boolean) {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        lookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, "", 0);
          const list = (Array.isArray(addresses) ? addresses : [addresses]) as Array<{ address: string; family: number }>;
          if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
            return callback(new FetchBlockedError(`Özel ağ adresine erişim engellendi: ${hostname}`), "", 0);
          }
          const first = list[0];
          if (!first) return callback(new Error("DNS sonucu yok"), "", 0);
          if ((options as { all?: boolean }).all) {
            return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
          }
          callback(null, first.address, first.family);
        });
      },
    },
  });
}

async function readLimited(res: Awaited<ReturnType<typeof undiciFetch>>): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Tek bir URL'yi güvenli şekilde getirir; yönlendirmeleri her adımda yeniden doğrular. */
export async function safeFetch(
  input: string | URL,
  opts: FetchOptions = {},
): Promise<{ finalUrl: URL; status: number; contentType: string; body: string }> {
  let url = typeof input === "string" ? normalizeUrl(input) : input;
  const agent = safeAgent(Boolean(opts.allowPrivateHosts));
  try {
    for (let hop = 0; hop < 5; hop++) {
      if (!opts.allowPrivateHosts && isIP(url.hostname) && isPrivateAddress(url.hostname)) {
        throw new FetchBlockedError("Özel ağ adreslerine erişim engellendi.");
      }
      const res = await undiciFetch(url, {
        dispatcher: agent,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) throw new Error("Yönlendirme adresi yok");
        url = normalizeUrl(new URL(loc, url).toString());
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const body = res.ok && /text\/(html|plain)|xhtml/i.test(contentType) ? await readLimited(res) : "";
      if (!body) await res.body?.cancel().catch(() => undefined);
      return { finalUrl: url, status: res.status, contentType, body };
    }
    throw new Error("Çok fazla yönlendirme");
  } finally {
    await agent.close().catch(() => undefined);
  }
}

// ── robots.txt ─────────────────────────────────────────────────────────

export function parseRobots(txt: string, userAgent: string): string[] {
  const disallow: Record<string, string[]> = {};
  let current: string[] = [];
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent) current = [];
      current.push(value.toLowerCase());
      disallow[value.toLowerCase()] ??= [];
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "disallow" && value) for (const a of current) disallow[a]!.push(value);
    }
  }
  const ua = userAgent.toLowerCase().split("/")[0]!;
  const specific = Object.keys(disallow).find((a) => a !== "*" && ua.includes(a));
  return disallow[specific ?? "*"] ?? [];
}

export function isAllowedByRobots(pathname: string, disallowed: string[]): boolean {
  return !disallowed.some((rule) => {
    const prefix = rule.replace(/\*.*$/, "").replace(/\$$/, "");
    return prefix === "/" ? true : pathname.startsWith(prefix);
  });
}

// ── İçerik çıkarma ─────────────────────────────────────────────────────

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?90[\s-]?)?\(?0?\s?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g;

export function extractPage(html: string, pageUrl: URL): PageContent {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const phones = new Set<string>();
  $("a[href^='mailto:']").each((_, el) => {
    const v = ($(el).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase();
    if (v) emails.add(v);
  });
  $("a[href^='tel:']").each((_, el) => {
    const v = ($(el).attr("href") ?? "").replace(/^tel:/i, "").trim();
    if (v) phones.add(v);
  });

  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href") ?? "", pageUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && registrableHost(u.hostname) === registrableHost(pageUrl.hostname)) {
        u.hash = "";
        links.add(u.toString());
      }
    } catch {
      /* geçersiz link */
    }
  });

  const title = $("title").first().text().trim();
  const metaDescription = $("meta[name='description']").attr("content")?.trim() ?? "";
  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((h) => h.length > 1 && h.length < 200)
    .slice(0, 60);

  $("script, style, noscript, svg, iframe, template, form").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_PER_PAGE);

  for (const m of text.match(EMAIL_RE) ?? []) {
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(m)) emails.add(m.toLowerCase());
  }
  for (const m of text.match(PHONE_RE) ?? []) phones.add(m.trim());

  return {
    url: pageUrl.toString(),
    title,
    metaDescription,
    headings,
    text,
    links: [...links],
    emails: [...emails].slice(0, 20),
    phones: [...phones].slice(0, 20),
  };
}

/** Şirket tanımak için öncelikli sayfa anahtar kelimeleri (TR + EN). */
const PRIORITY_KEYWORDS = [
  "hakkimizda", "hakkımızda", "kurumsal", "about", "company",
  "urun", "ürün", "product", "katalog", "catalog",
  "hizmet", "service", "uretim", "üretim", "production", "manufactur",
  "kalite", "quality", "sertifika", "certificate", "belge",
  "sektor", "sektör", "industr", "uygulama", "application",
  "iletisim", "iletişim", "contact", "referans", "reference",
];

export function rankLinks(links: string[], home: URL): string[] {
  const skip = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|mp4)$/i;
  const score = (u: string) => {
    const path = decodeURIComponent(new URL(u).pathname.toLowerCase());
    let s = 0;
    PRIORITY_KEYWORDS.forEach((k, i) => {
      if (path.includes(k)) s += 100 - i;
    });
    return s - path.split("/").length * 2;
  };
  return links
    .filter((u) => !skip.test(u) && new URL(u).pathname !== home.pathname)
    .map((u) => ({ u, s: score(u) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u);
}

export interface CrawlResult {
  homeUrl: string;
  pages: PageContent[];
  skipped: Array<{ url: string; reason: string }>;
}

/**
 * Şirket sitesini tarar: ana sayfa + en fazla `maxPages - 1` öncelikli iç sayfa.
 * robots.txt'ye uyar; sayfalar arası kısa bekleme yapar.
 */
export async function crawlSite(input: string, opts: FetchOptions & { maxPages?: number } = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 6;
  const start = normalizeUrl(input);
  const skipped: CrawlResult["skipped"] = [];

  let disallowed: string[] = [];
  try {
    const robots = await safeFetch(new URL("/robots.txt", start), { ...opts, timeoutMs: 6_000 });
    if (robots.status === 200) disallowed = parseRobots(robots.body, USER_AGENT);
  } catch {
    /* robots.txt yoksa devam */
  }
  if (!isAllowedByRobots(start.pathname, disallowed)) {
    throw new FetchBlockedError("Sitenin robots.txt dosyası analize izin vermiyor.");
  }

  const home = await safeFetch(start, opts);
  if (home.status >= 400 || !home.body) {
    throw new Error(`Site açılamadı (HTTP ${home.status}).`);
  }
  const homePage = extractPage(home.body, home.finalUrl);
  const pages: PageContent[] = [homePage];

  for (const link of rankLinks(homePage.links, home.finalUrl)) {
    if (pages.length >= maxPages) break;
    const u = new URL(link);
    if (!isAllowedByRobots(u.pathname, disallowed)) {
      skipped.push({ url: link, reason: "robots.txt" });
      continue;
    }
    try {
      await new Promise((r) => setTimeout(r, 300));
      const res = await safeFetch(u, opts);
      if (res.status < 400 && res.body) pages.push(extractPage(res.body, res.finalUrl));
      else skipped.push({ url: link, reason: `HTTP ${res.status}` });
    } catch (err) {
      skipped.push({ url: link, reason: (err as Error).message.slice(0, 120) });
    }
  }

  return { homeUrl: home.finalUrl.toString(), pages, skipped };
}
