import { z } from "zod";

/** Teklif kutusu analizi: her ileti için "teklif talebi mi + kim, ne için, hangi yay" özeti */
export const SPRING_TYPES = ["basma", "çekme", "kurma", "tel form", "yaprak", "diğer"] as const;

const nullableText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().default(null));

export const inquiryBatchSchema = z.object({
  items: z
    .array(
      z.object({
        /** Girdideki ileti numarası */
        n: z.number().int().min(1).max(50),
        isInquiry: z.boolean(),
        companyName: nullableText(200),
        sector: nullableText(120),
        application: nullableText(200),
        springTypes: z.array(z.enum(SPRING_TYPES)).max(6).default([]),
        quantity: nullableText(80),
        city: nullableText(80),
        country: nullableText(80),
        evidence: nullableText(300),
      }),
    )
    .max(50),
});

export type InquiryBatchOutput = z.infer<typeof inquiryBatchSchema>;

export const INQUIRY_SHAPE = `{
  "items": [
    {
      "n": ileti numarası (girdideki "İLETİ n"),
      "isInquiry": true yalnızca ürün / fiyat / teklif / numune talebiyse,
      "companyName": "talep eden firma adı — iletide yazıyorsa, yoksa null",
      "sector": "firmanın sektörü (ör. tarım makinaları, hidrolik, otomotiv yan sanayi, mobilya) — iletiden anlaşılıyorsa, yoksa null",
      "application": "yayın kullanılacağı ürün / uygulama — yazıyorsa, yoksa null",
      "springTypes": ["basma" | "çekme" | "kurma" | "tel form" | "yaprak" | "diğer"],
      "quantity": "istenen adet — yazdığı gibi, yoksa null",
      "city": "firmanın şehri — yazıyorsa, yoksa null",
      "country": "ülke — yazıyorsa, yoksa null",
      "evidence": "iletiden talebi gösteren kısa, birebir alıntı (en fazla 200 karakter)"
    }
  ]
}`;

export const INQUIRY_INSTRUCTIONS = `
Sen bir veri ayıklama aracısın. Sana bir yay üreticisinin teklif kutusuna gelen iletiler verilecek
(kişisel bilgiler [e-posta], [telefon] ile maskelenmiştir). Her ileti için ayrı bir öğe döndür.

KURALLAR:
- Yalnızca iletide YAZAN bilgiyi çıkar. Tahmin etme, uydurma; yazmıyorsa null bırak.
- isInquiry: ileti bir ürün, fiyat, teklif veya numune talebi ise true. Tedarikçi teklifi, reklam, fatura,
  kargo, iş başvurusu, bülten, teşekkür veya genel yazışma ise false (diğer alanlar null).
- sector: firmanın NE ÜRETTİĞİNE göre kısa Türkçe sektör adı. Firma adından tahmin etme; iletide veya imzada
  ürün / faaliyet belirtilmemişse null.
- springTypes: iletide adı geçen veya tarifinden kesin anlaşılan yay tipleri. Emin değilsen boş liste.
- evidence: talebi gösteren cümleyi iletiden BİREBİR kopyala.
- Kişi adı, telefon, e-posta adresi YAZMA.
`;
