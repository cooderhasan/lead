const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };

/** Türkçe karakterleri ASCII'ye çevirip URL uyumlu slug üretir. */
export function slugify(input: string): string {
  return input
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sirket";
}

/** Karşılaştırma için normalize edilmiş şirket adı (dedupe, Faz 2). */
export function normalizeCompanyName(name: string): string {
  return slugify(name)
    .replace(/-(a-s|as|ltd|sti|san|tic|ve|limited|sirketi|anonim|ins|dis|paz|gmbh|inc|llc|co)(?=-|$)/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
