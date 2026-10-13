/** Türkiye'yi gösteren ülke değerleri (kaynaklar "TR", "Türkiye", "Turkey" … yazabiliyor) */
const TURKEY_NAMES = ["tr", "tur", "turkey", "türkiye", "turkiye"];

const capitalize = (s: string, locale?: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

/** Veritabanı filtresi için yazım biçimleri (TR, Tr, Türkiye, TÜRKİYE, TURKEY …) */
export const TURKEY_COUNTRY_VARIANTS = [
  ...new Set(TURKEY_NAMES.flatMap((n) => [n, n.toUpperCase(), n.toLocaleUpperCase("tr"), capitalize(n), capitalize(n, "tr")])),
];

/** Lead yurt içi mi? Ülke boşsa Türkiye varsayılır (ana pazar). */
export function isDomesticCountry(country?: string | null): boolean {
  // "TÜRKİYE".toLowerCase() → "türki̇ye" (birleşik nokta): nokta atılır
  const c = (country ?? "").trim().toLowerCase().replace(/̇/g, "");
  return !c || TURKEY_NAMES.includes(c);
}
