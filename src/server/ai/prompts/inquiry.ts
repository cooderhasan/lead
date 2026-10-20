import { z } from "zod";

/** Teklif kutusu analizi: her ileti için "teklif talebi mi + kim, ne için, hangi yay" özeti */
export const SPRING_TYPES = ["basma", "çekme", "kurma", "tel form", "yaprak", "diğer"] as const;

/** Rapor kırılımı için sabit sektör listesi (serbest metin "makine / makina imalatı" gibi bölünmesin) */
export const INQUIRY_CATEGORIES = [
  "Otomotiv ve taşıt parçaları",
  "Makine imalatı",
  "Hidrolik ve pnömatik",
  "Tarım makinaları",
  "Savunma ve havacılık",
  "Raylı sistemler",
  "Enerji santralleri",
  "Maden ve metal tesisleri",
  "Yapı, ev ve beyaz eşya ürünleri",
  "İklimlendirme ve HVAC",
  "Gıda ve proses tesisleri",
  "Medikal",
  "Elektrik ve elektronik",
  "Diğer",
] as const;

export const INQUIRY_PURPOSES = ["seri üretim", "bakım-onarım", "prototip / proje", "belirsiz"] as const;

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
        // Liste dışı değer gelirse rapor bozulmasın
        category: z.enum(INQUIRY_CATEGORIES).nullable().catch("Diğer").default(null),
        purpose: z.enum(INQUIRY_PURPOSES).catch("belirsiz").default("belirsiz"),
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
      "category": "aşağıdaki SEKTÖR KATEGORİLERİNDEN biri — anlaşılmıyorsa null",
      "purpose": "seri üretim" | "bakım-onarım" | "prototip / proje" | "belirsiz",
      "sector": "firmanın ne ürettiği / ne iş yaptığı, kısa serbest metin (ör. debriyaj seti üretimi, termik santral) — yoksa null",
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
- category: firmanın NE ÜRETTİĞİNE / NE İŞ YAPTIĞINA göre şu listeden TAM OLARAK biri:
  ${INQUIRY_CATEGORIES.join(" · ")}
  İletide, imzada, firma unvanında veya "Gönderen alan adı" satırında (ör. hidroliksan.com → Hidrolik ve pnömatik,
  cayirhanenerji.com.tr → Enerji santralleri) faaliyet anlaşılmıyorsa null. Listede uygun yoksa "Diğer".
- purpose: yay ne için isteniyor?
  "seri üretim": firmanın kendi ürününe takılan parça; tekrarlı / yıllık ihtiyaç veya yüksek adet.
  "bakım-onarım": tesis, santral, maden, çimento / beton santrali, fabrika veya atölye makinesinde değişim /
  yedek parça; eski veya deforme numune. Kamu işletmelerinin ve tesislerin malzeme talepleri genelde budur.
  "prototip / proje": numune, test, yeni ürün geliştirme, tek seferlik proje.
  Anlaşılmıyorsa "belirsiz".
- sector: firmanın faaliyetinin kısa serbest metin ayrıntısı. Firma adından tahmin etme; belirtilmemişse null.
- springTypes: iletide adı geçen veya tarifinden kesin anlaşılan yay tipleri. Emin değilsen boş liste.
- evidence: talebi gösteren cümleyi iletiden BİREBİR kopyala.
- Kişi adı, telefon, e-posta adresi YAZMA.
`;
