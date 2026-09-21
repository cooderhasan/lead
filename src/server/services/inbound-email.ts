import "server-only";
import { findCompanyForInbound } from "@/server/tenancy/message-lookup";
import { recordInboundReply } from "./conversations";

export interface ParsedInbound {
  from: string;
  to: string[];
  subject: string | null;
  text: string;
  references: string[];
}

const splitRefs = (v: unknown): string[] =>
  typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : Array.isArray(v) ? v.flatMap(splitRefs) : [];

const addr = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v.match(/<([^>]+)>/)?.[1] ?? v;
  if (typeof v === "object") {
    const o = v as { Address?: string; address?: string; email?: string };
    return o.Address ?? o.address ?? o.email ?? null;
  }
  return null;
};

/**
 * Gelen e-posta gövdesini ortak biçime çevirir.
 * Desteklenen: Brevo Inbound Parsing ({items:[…]}) ve genel JSON
 * ({from, to, subject, text, inReplyTo, references}) — Zapier/Make/n8n veya kendi IMAP köprünüz için.
 */
export function parseInboundPayload(body: unknown): ParsedInbound[] {
  const b = body as Record<string, unknown>;
  const items = Array.isArray(b?.items) ? (b.items as Array<Record<string, unknown>>) : [b];
  const out: ParsedInbound[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const from = addr(it.From ?? it.from);
    const toRaw = it.To ?? it.to;
    const to = (Array.isArray(toRaw) ? toRaw : [toRaw]).map(addr).filter((x): x is string => Boolean(x));
    const text =
      (typeof it.ExtractedMarkdownMessage === "string" && it.ExtractedMarkdownMessage) ||
      (typeof it.RawTextBody === "string" && it.RawTextBody) ||
      (typeof it.text === "string" && it.text) ||
      "";
    const headers = (it.Headers ?? it.headers ?? {}) as Record<string, unknown>;
    const references = [
      ...splitRefs(it.InReplyTo ?? it.inReplyTo ?? headers["In-Reply-To"] ?? headers["in-reply-to"]),
      ...splitRefs(it.References ?? it.references ?? headers.References ?? headers.references),
    ];
    if (!from || !text.trim()) continue;
    out.push({ from, to, subject: typeof (it.Subject ?? it.subject) === "string" ? String(it.Subject ?? it.subject) : null, text, references });
  }
  return out;
}

/** Webhook'tan gelen her yanıtı doğru şirkete kaydeder; eşleşmeyenler atlanır (başka şirkete yazılmaz). */
export async function ingestInbound(items: ParsedInbound[]) {
  let recorded = 0;
  let unmatched = 0;
  for (const item of items.slice(0, 50)) {
    const companyId = await findCompanyForInbound({ references: item.references, to: item.to });
    if (!companyId) {
      unmatched++;
      continue;
    }
    const res = await recordInboundReply(
      companyId,
      { fromAddress: item.from, toAddress: item.to[0] ?? null, subject: item.subject, body: item.text, references: item.references },
      { source: "webhook" },
    );
    if (res.matched) recorded++;
    else unmatched++;
  }
  return { recorded, unmatched };
}
