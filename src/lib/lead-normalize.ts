/**
 * Lead dedupe ve eşleştirme için normalizasyon yardımcıları (spec §36, Faz 2).
 * Saf fonksiyonlardır — sunucu/istemci fark etmeksizin kullanılabilir ve birim testlidir.
 */
import { normalizeCompanyName } from "./slug";

/** Firma adı dedupe anahtarı: "Aktif Yay San. ve Tic. A.Ş." → "aktif-yay" (tek kaynak: lib/slug). */
export { normalizeCompanyName };

/** URL veya alan adından kök alan adı: "https://www.Aktifyay.com.tr/urunler" → "aktifyay.com.tr" */
export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  let host: string;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || /\s/.test(host)) return null;
  // Sosyal medya / pazaryeri alan adları firma alan adı sayılmaz
  if (GENERIC_HOSTS.has(host)) return null;
  return host;
}

const GENERIC_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com",
  "google.com", "maps.google.com", "business.site", "wa.me", "sahibinden.com", "n11.com",
  "trendyol.com", "hepsiburada.com", "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
]);

/** Sosyal medya/pazaryeri gibi firmaya özel olmayan alan adı mı? */
export function isGenericHost(host: string): boolean {
  return GENERIC_HOSTS.has(host.toLowerCase().replace(/^www\./, ""));
}

/**
 * Telefonu E.164'e yakın biçime getirir (varsayılan ülke TR).
 * "0532 123 45 67" → "+905321234567" · "+49 30 123456" → "+4930123456"
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: "TR" = "TR"): string | null {
  if (!input) return null;
  const hasPlus = input.trim().startsWith("+");
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (defaultCountry === "TR") {
      // "90…" zaten ülke kodlu; "0532…" ve "532…" tamamlanır
      if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
      else if (digits.length === 10) digits = `90${digits}`;
    }
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

const GENERIC_MAILBOXES = new Set([
  "info", "bilgi", "iletisim", "contact", "sales", "satis", "destek", "support", "musteri",
  "hello", "merhaba", "office", "ofis", "admin", "mail", "kurumsal", "ik", "hr", "muhasebe", "export", "ihracat",
  "satinalma", "purchasing", "siparis", "order", "orders", "teklif", "genel", "pazarlama", "marketing", "info1", "infotr",
]);

/** Satış teması için tercih sırası (satın alma en iyisi); İK / muhasebe kutuları hiç seçilmez. */
const EMAIL_PREFERENCE = ["satinalma", "purchasing", "info", "bilgi", "iletisim", "contact", "satis", "sales", "siparis", "teklif", "genel", "kurumsal", "ihracat", "export", "office", "ofis"];
const NEVER_PICK = new Set(["ik", "hr", "muhasebe", "admin", "destek", "support"]);
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|yandex|icloud|mail)\.(com|com\.tr|net)$/;

/**
 * Web sitesinde BULUNAN adresler arasından firmanın kurumsal genel e-postasını seçer (AI'sız, uydurma yok).
 * Kabul: kişisel olmayan kutu (info@, satinalma@…) ve sitenin kendi alan adı. Alan adı farklıysa
 * (ör. web ajansının adresi) seçilmez; yalnızca ücretsiz posta servisinde firma adını taşıyan adres (firmaadi@gmail.com) kabul edilir.
 */
export function pickCompanyEmail(emails: string[], website: string | null | undefined): string | null {
  const site = extractDomain(website ?? "");
  const siteToken = site?.split(".")[0]?.replace(/-/g, "") ?? "";
  const candidates: Array<{ email: string; rank: number }> = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email || /no-?reply|mailer-daemon|postmaster|example\.|sentry|wixpress/.test(email)) continue;
    const [local = "", domain = ""] = email.split("@");
    const key = local.replace(/[._-]/g, "");
    const sameDomain = Boolean(site && (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)));
    if (sameDomain) {
      if (!isGenericEmail(email) || NEVER_PICK.has(key)) continue;
      const i = EMAIL_PREFERENCE.indexOf(key);
      candidates.push({ email, rank: i === -1 ? EMAIL_PREFERENCE.length : i });
    } else if (FREE_MAIL.test(domain) && siteToken.length >= 4 && key.includes(siteToken)) {
      candidates.push({ email, rank: EMAIL_PREFERENCE.length + 1 });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.email ?? null;
}

/** Kurumsal genel kutu mu (info@…) yoksa kişiye ait mi? Kişisel adresler LeadContact'ta ayrı tutulur. */
export function isGenericEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.split("@")[0]?.toLocaleLowerCase("tr").replace(/[._-]/g, "") ?? "";
  return GENERIC_MAILBOXES.has(local);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

/** İki firma adının aynı firmayı gösterme olasılığı (0..1) — dedupe eşiği için. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ax = new Set(x.split("-"));
  const by = new Set(y.split("-"));
  let common = 0;
  for (const t of ax) if (by.has(t)) common++;
  return (2 * common) / (ax.size + by.size);
}
