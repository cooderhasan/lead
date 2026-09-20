import { z } from "zod";

/** "a, b\nc" → ["a","b","c"] — virgül veya satır sonuyla ayrılmış liste alanları. */
export const listField = (max = 50, itemMax = 200) =>
  z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== "string") return [];
      return v
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    },
    z.array(z.string().max(itemMax)).max(max),
  );

/** Yalnızca satır sonuyla ayrılan liste (öğeler virgül içerebilir: kurallar, ürün adları). */
export const lineListField = (max = 50, itemMax = 500) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/).map((s) => s.trim()).filter(Boolean) : []),
    z.array(z.string().max(itemMax)).max(max),
  );

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v), z.string().max(max).nullable().optional());

const optInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[.\s]/g, ""))),
  z.number().int().min(0).max(10_000_000).nullable().optional(),
);

const optMoney = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return null;
    // "500.000,50" (TR) veya "500000.50" kabul
    const s = String(v).trim().replace(/\s/g, "");
    const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    return Number(normalized);
  },
  z.number().min(0).max(1e13).nullable().optional(),
);

const optBool = z.preprocess(
  (v) => (v === "yes" || v === "true" || v === true ? true : v === "no" || v === "false" || v === false ? false : null),
  z.boolean().nullable().optional(),
);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Adınızı girin.").max(100),
  email: z.string().trim().email("Geçerli bir e-posta girin.").max(200),
  password: z.string().min(10, "Parola en az 10 karakter olmalı.").max(200),
  companyName: z.string().trim().min(2, "Firma adını girin.").max(150),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin."),
  password: z.string().min(1, "Parolanızı girin."),
});

export const websiteSchema = z.object({
  website: z.string().trim().min(3, "Web sitesi adresini girin.").max(500),
});

export const companyInfoSchema = z.object({
  name: z.string().trim().min(2, "Firma adını girin.").max(150),
  website: optText(500),
  sector: optText(200),
  subSector: optText(200),
  country: optText(100),
  city: optText(100),
  serviceRegions: listField(30, 100),
  sizeBand: optText(50),
  employeeCount: optInt,
  description: optText(2000),
});

export const productionInfoSchema = z.object({
  minOrder: optText(300),
  priceRangeNote: optText(300),
  avgOrderValue: optMoney,
  productionCapacity: optText(500),
  deliveryTime: optText(300),
  customManufacturing: optBool,
  certifications: listField(30, 150),
  productNames: lineListField(50, 200),
});

export const targetMarketSchema = z.object({
  name: z.string().trim().min(2).max(150).default("Ana hedef pazar"),
  businessModel: optText(20),
  industries: listField(30, 150),
  subIndustries: listField(30, 150),
  countries: listField(30, 100),
  cities: listField(50, 100),
  minEmployees: optInt,
  maxEmployees: optInt,
  minRevenue: optMoney,
  customerTypes: listField(20, 150),
  decisionMakerRoles: listField(20, 150),
  notes: optText(2000),
});

export const salesInfoSchema = z.object({
  currency: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  avgSaleValue: optMoney,
  salesCycleDays: optInt,
  monthlySalesTarget: optMoney,
  existingCustomerTypes: listField(20, 150),
  existingCustomerExamples: listField(30, 150),
});

export const competitorSchema = z.object({
  name: z.string().trim().min(1, "Rakip adını girin.").max(150),
  website: optText(500),
  strengths: listField(15, 200),
  weaknesses: listField(15, 200),
  notes: optText(1000),
});

export const exclusionsSchema = z.object({
  industries: listField(30, 150),
  cities: listField(50, 100),
  customerTypes: listField(20, 150),
  rules: lineListField(20, 500),
  notes: optText(2000),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, "Ürün adını girin.").max(200),
  sku: optText(100),
  categoryName: optText(200),
  description: optText(3000),
  technicalSpecsText: optText(5000),
  materials: listField(20, 100),
  dimensions: optText(300),
  applications: listField(30, 200),
  industries: listField(30, 150),
  minOrder: optText(200),
  priceRange: optText(200),
  deliveryTime: optText(200),
  certifications: listField(20, 150),
  active: optBool,
});

export const memorySchema = z.object({
  type: z.enum(["RULE", "PREFERENCE", "FACT"]),
  content: z.string().trim().min(5, "Kuralı en az birkaç kelimeyle yazın.").max(1000),
});

export const factEditSchema = z.object({
  factId: z.string().min(1),
  value: z.string().trim().min(1, "Değer boş olamaz.").max(1500),
});

/** "Tel çapı: 0,5–8 mm" satırlarını anahtar/değer nesnesine çevirir. */
export function parseSpecs(text: string | null | undefined): Record<string, string> | null {
  if (!text) return null;
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) out[k.slice(0, 100)] = v.slice(0, 300);
  }
  return Object.keys(out).length ? out : null;
}

export function specsToText(specs: unknown): string {
  if (!specs || typeof specs !== "object") return "";
  return Object.entries(specs as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}
