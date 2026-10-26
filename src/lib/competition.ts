/**
 * Rakip (yay üreticisi) tespiti: kampanyalara rakip firmalar alınmaz.
 * Firma adında veya sektöründe "yay / spring / zemberek" kelimesi AYRI bir kelime olarak geçiyorsa yay üreticisi sayılır
 * ("Yaytek Mak. Oto. Yay İml." → evet; "Yayla Gıda", "Yayın Evi" → hayır).
 */
const SPRING_WORDS = new Set(["yay", "yayi", "yaylar", "yaylari", "zemberek", "spring", "springs", "federn", "ressort", "ressorts"]);

const fold = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Saf fonksiyon */
export function looksLikeSpringMaker(...texts: Array<string | null | undefined>): boolean {
  return fold(texts.filter(Boolean).join(" "))
    .split(" ")
    .some((w) => SPRING_WORDS.has(w));
}

/** Lead rakip mi: adı / sektörü yay üreticisi gösteriyor veya alan adı Rakipler listesinde. Saf fonksiyon. */
export function isCompetitorLead(
  lead: { companyName: string; industry?: string | null; domain?: string | null },
  competitorDomains: ReadonlySet<string>,
): boolean {
  if (lead.domain && competitorDomains.has(lead.domain.toLowerCase())) return true;
  return looksLikeSpringMaker(lead.companyName, lead.industry);
}
