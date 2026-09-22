import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { assertCan } from "@/server/tenancy/permissions";
import type { TenantContext } from "@/server/tenancy/types";
import { env } from "@/server/env";
import { ai, isAIConfigured } from "@/server/ai";
import { untrusted } from "@/server/ai/guardrails";
import { LEAD_SEARCH_INSTRUCTIONS, LEAD_SEARCH_SHAPE, leadSearchSchema } from "@/server/ai/prompts/lead-search";
import {
  LEAD_RESEARCH_INSTRUCTIONS,
  LEAD_RESEARCH_SHAPE,
  leadResearchSchema,
  type LeadResearchOutput,
} from "@/server/ai/prompts/lead-research";
import { LEAD_SCORE_INSTRUCTIONS, LEAD_SCORE_SHAPE, leadScoreSchema } from "@/server/ai/prompts/lead-score";
import { isLeadSourceConfigured } from "@/server/providers/lead-source";
import { csvToRawLeads } from "@/server/providers/lead-source/csv";
import type { LeadSearchQuery } from "@/server/providers/lead-source/types";
import { crawlSite, FetchBlockedError } from "@/server/web/fetch-site";
import { crawlToPrompt, allowPrivateFetch } from "@/server/jobs/handlers/website-analyze";
import { enqueue } from "@/server/jobs/queue";
import { consumeCredits, CREDIT_COSTS, refundCredits } from "@/server/usage/credits";
import { audit } from "@/server/audit/audit";
import { buildVerifiedCompanyContext } from "./facts";
import { evidenceFound, valueFound } from "./evidence";
import { saveDiscoveredLeads } from "./leads";
import { AppError } from "@/lib/errors";
import { computeReachability, finalizeScore } from "@/lib/lead-scoring";
import { extractDomain, isGenericEmail, normalizeEmail, normalizePhone, pickCompanyEmail } from "@/lib/lead-normalize";

const REFRESH_DAYS = 90;

// ── Satıcı şirket bağlamı (yalnızca doğrulanmış bilgi) ─────────────────

async function sellerContext(companyId: string) {
  const [verified, markets] = await Promise.all([
    buildVerifiedCompanyContext({ companyId }),
    tenantDb({ companyId }).targetMarket.findMany({
      select: { name: true, isExcluded: true, industries: true, cities: true, countries: true, minEmployees: true, maxEmployees: true, notes: true },
      orderBy: { priority: "desc" },
    }),
  ]);
  const productNames = verified.products.map((p) => p.name);
  const text = JSON.stringify(
    {
      company: verified.name,
      sector: verified.sector,
      summary: verified.summary,
      verifiedFacts: verified.facts.slice(0, 60),
      products: verified.products.slice(0, 40).map((p) => ({
        name: p.name,
        description: p.description?.slice(0, 300) ?? null,
        applications: p.applications,
        industries: p.industries,
      })),
      targetMarkets: markets.filter((m) => !m.isExcluded),
      excludedCustomers: markets.filter((m) => m.isExcluded),
      rules: verified.rules.slice(0, 30),
    },
    null,
    1,
  );
  return { text, productNames, hasProducts: productNames.length > 0 };
}

// ── 1) Doğal dil arama ───────────────────────────────────────────────

export interface ParsedSearch {
  query: LeadSearchQuery;
  interpretation: string;
}

/** AI kapalıyken arama ifadesi olduğu gibi kullanılır (zarif düşüş). */
export function fallbackSearch(prompt: string, limit: number): ParsedSearch {
  return {
    query: { keywords: [prompt.trim().slice(0, 80)], country: "Türkiye", cities: [], districts: [], industries: [], limit },
    interpretation: "AI kapalı olduğu için arama ifadesi olduğu gibi kullanıldı.",
  };
}

async function parseSearchPrompt(ctx: TenantContext, prompt: string, maxLimit: number): Promise<ParsedSearch> {
  if (!isAIConfigured()) return fallbackSearch(prompt, maxLimit);
  const seller = await sellerContext(ctx.companyId);
  const { data } = await ai({ companyId: ctx.companyId, operation: "lead.search.parse" }).extract({
    schema: leadSearchSchema,
    tier: "fast",
    instructions: LEAD_SEARCH_INSTRUCTIONS,
    shape: LEAD_SEARCH_SHAPE,
    input: `ŞİRKET BAĞLAMI:\n${seller.text}\n\nKULLANICI İSTEĞİ:\n${untrusted("user-search", prompt, 1000)}`,
    maxTokens: 800,
  });
  return {
    query: {
      keywords: data.keywords,
      industries: data.industries,
      country: data.country ?? "Türkiye",
      cities: data.cities,
      districts: data.districts,
      limit: Math.min(data.requestedLimit ?? maxLimit, maxLimit),
    },
    interpretation: data.interpretation,
  };
}

/**
 * Lead aramasını başlatır. Kredi, bulunabilecek en fazla lead sayısı kadar önden ayrılır;
 * iş bitince yalnızca YENİ eklenen lead'ler ücretlendirilir, kalan iade edilir.
 */
export async function startLeadSearch(ctx: TenantContext, prompt: string, requestedLimit?: number) {
  assertCan(ctx, "lead.write");
  const text = prompt.trim();
  if (text.length < 3) throw new AppError("VALIDATION", "Ne tür firmalar aradığınızı yazın.", { prompt: "En az 3 karakter" });
  if (!isLeadSourceConfigured()) {
    throw new AppError(
      "VALIDATION",
      "Otomatik lead arama kapalı (APIFY_TOKEN tanımlı değil). CSV ile içe aktarabilir veya elle ekleyebilirsiniz.",
    );
  }
  const db = tenantDb(ctx);
  const running = await db.job.findFirst({
    where: { type: "lead.search", status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (running) throw new AppError("CONFLICT", "Devam eden bir arama var. Bitince yeni arama başlatabilirsiniz.");

  const max = Math.min(requestedLimit ?? env().LEAD_SEARCH_MAX, env().LEAD_SEARCH_MAX);
  const parsed = await parseSearchPrompt(ctx, text, max);
  const reserved = parsed.query.limit;

  const { usageId } = await consumeCredits({
    companyId: ctx.companyId,
    operation: "lead.discovery",
    quantity: reserved,
    userId: ctx.userId,
    refType: "lead.search",
  });

  let jobId: string;
  try {
    jobId = await enqueue(
      "lead.search",
      { prompt: text.slice(0, 1000), interpretation: parsed.interpretation, query: parsed.query, usageId, reserved },
      { companyId: ctx.companyId, createdById: ctx.userId, maxAttempts: 3 },
    );
  } catch (err) {
    await refundCredits(usageId, "lead.search.enqueue_failed");
    throw err;
  }

  await audit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "lead.search.started",
    entityType: "Job",
    entityId: jobId,
    metadata: { prompt: text.slice(0, 300), query: parsed.query as unknown as Prisma.InputJsonValue, reserved },
  });
  return { jobId, interpretation: parsed.interpretation, reserved };
}

export async function listRecentSearches(ctx: TenantContext, take = 8) {
  assertCan(ctx, "lead.read");
  const jobs = await tenantDb(ctx).job.findMany({
    where: { type: "lead.search" },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, status: true, progress: true, error: true, payload: true, result: true, createdAt: true, finishedAt: true },
  });
  return jobs.map((j) => {
    const p = j.payload as { prompt?: string; interpretation?: string; reserved?: number };
    const r = (j.result ?? {}) as { created?: number; merged?: number; found?: number };
    return {
      id: j.id,
      status: j.status,
      progress: j.progress,
      error: j.error,
      prompt: p.prompt ?? "",
      interpretation: p.interpretation ?? "",
      created: r.created ?? null,
      merged: r.merged ?? null,
      found: r.found ?? null,
      createdAt: j.createdAt,
    };
  });
}

// ── 2) CSV içe aktarma ────────────────────────────────────────────────

/** CSV içe aktarma kredi harcamaz (dış kaynak maliyeti yok). */
export async function importLeadsCsv(ctx: TenantContext, text: string) {
  assertCan(ctx, "lead.write");
  if (text.length > 5_000_000) throw new AppError("VALIDATION", "CSV dosyası en fazla 5 MB olabilir.");
  const parsed = csvToRawLeads(text);
  if (parsed.leads.length === 0) {
    throw new AppError(
      "VALIDATION",
      "CSV'de firma adı sütunu bulunamadı. İlk satırda 'Firma' (veya 'Firma Adı', 'Company') başlığı olmalı.",
    );
  }
  const result = await saveDiscoveredLeads(ctx.companyId, parsed.leads, { provider: "csv" });
  await audit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "lead.csv_imported",
    metadata: { created: result.created, merged: result.merged, skipped: result.skipped + parsed.skippedRows },
  });
  return { ...result, skipped: result.skipped + parsed.skippedRows, unknownHeaders: parsed.unknownHeaders };
}

// ── 3) Araştırma (zenginleştirme) ─────────────────────────────────────

export async function startLeadResearch(ctx: TenantContext, leadId: string) {
  assertCan(ctx, "lead.write");
  if (!isAIConfigured()) {
    throw new AppError("AI_UNAVAILABLE", "AI sağlayıcısı yapılandırılmamış (.env → ANTHROPIC_API_KEY).");
  }
  const db = tenantDb(ctx);
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true, website: true } });
  if (!lead) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  if (!lead.website) {
    throw new AppError("VALIDATION", "Bu lead'in web sitesi yok. Araştırma için önce web sitesini ekleyin; puanlama yine yapılabilir.");
  }
  const running = await db.job.findFirst({
    where: { type: "lead.enrich", status: { in: ["QUEUED", "RUNNING"] }, payload: { path: ["leadId"], equals: leadId } },
    select: { id: true },
  });
  if (running) return { jobId: running.id, alreadyRunning: true };

  const { usageId } = await consumeCredits({
    companyId: ctx.companyId,
    operation: "lead.enrich",
    userId: ctx.userId,
    refType: "Lead",
    refId: leadId,
  });
  let jobId: string;
  try {
    jobId = await enqueue("lead.enrich", { leadId, usageId }, { companyId: ctx.companyId, createdById: ctx.userId });
  } catch (err) {
    await refundCredits(usageId, "lead.enrich.enqueue_failed");
    throw err;
  }
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "lead.research.started", entityType: "Lead", entityId: leadId });
  return { jobId, alreadyRunning: false };
}

/** Enrichment JSON yapısı (Lead.enrichment) */
export interface LeadEnrichment {
  researchedAt: string;
  sourceUrl: string;
  pages: string[];
  products: string[];
  verified: Array<{ statement: string; sourceUrl?: string | null; evidence?: string | null }>;
  assumptions: Array<{ statement: string; reason: string }>;
  /** Kanıtı sayfada bulunamadığı için doğrulanmıştan varsayıma taşınan öğe sayısı */
  downgraded: number;
}

/**
 * AI çıktısını kaynak metne karşı doğrular: kanıt alıntısı sayfada yoksa bilgi "doğrulanmış" sayılmaz.
 * Saf fonksiyon — testlerde doğrudan kullanılır.
 */
export function verifyResearch(data: LeadResearchOutput, corpus: string) {
  const verified: LeadEnrichment["verified"] = [];
  const assumptions: LeadEnrichment["assumptions"] = [...data.assumptions];
  let downgraded = 0;
  for (const c of data.verified) {
    if (evidenceFound(c.evidence, corpus)) verified.push(c);
    else {
      downgraded++;
      assumptions.push({ statement: c.statement, reason: "Kaynak sayfada kanıtı doğrulanamadı." });
    }
  }
  const signals = data.signals.filter((s) => evidenceFound(s.evidence, corpus));
  const email = normalizeEmail(data.genericEmail);
  const phone = data.phone && valueFound(data.phone, corpus) ? data.phone : null;
  const sizeProven =
    (data.employeeCountMin !== null && valueFound(String(data.employeeCountMin), corpus)) ||
    (data.employeeCountMax !== null && valueFound(String(data.employeeCountMax), corpus));
  return {
    verified,
    assumptions: assumptions.slice(0, 20),
    downgraded,
    signals,
    // Kişisel adres asla lead genel e-postasına yazılmaz
    genericEmail: email && isGenericEmail(email) && valueFound(email, corpus) ? email : null,
    phone,
    employeeCountMin: sizeProven ? data.employeeCountMin : null,
    employeeCountMax: sizeProven ? data.employeeCountMax : null,
  };
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000 ? null : d;
}

/** İş (job) içinden çağrılır. Lead web sitesini tarar, AI ile özetler, kanıtları doğrular. */
export async function researchLead(companyId: string, leadId: string, progress?: (pct: number) => Promise<void>) {
  const db = tenantDb({ companyId });
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  if (!lead.website) throw new AppError("VALIDATION", "Lead'in web sitesi yok.");

  let crawl;
  try {
    crawl = await crawlSite(lead.website, { maxPages: 4, ensureContactPage: true, allowPrivateHosts: allowPrivateFetch() });
  } catch (err) {
    if (err instanceof FetchBlockedError) throw new AppError("EXTERNAL_FETCH", err.message);
    throw new AppError("EXTERNAL_FETCH", `Lead sitesine ulaşılamadı: ${(err as Error).message}`);
  }
  const corpus = crawl.pages.map((p) => [p.title, p.metaDescription, p.headings.join(" "), p.text].join(" ")).join("\n");
  if (corpus.replace(/\s+/g, "").length < 150) {
    throw new AppError("EXTERNAL_FETCH", "Lead sitesinde okunabilir metin bulunamadı (içerik JavaScript ile yükleniyor olabilir).");
  }
  await progress?.(35);

  const { data } = await ai({ companyId, operation: "lead.research" }).extract({
    schema: leadResearchSchema,
    instructions: LEAD_RESEARCH_INSTRUCTIONS,
    shape: LEAD_RESEARCH_SHAPE,
    input: `Firma: ${lead.companyName}\n\n${untrusted("lead-website", crawlToPrompt(crawl, 40_000))}`,
    maxTokens: 4000,
  });
  await progress?.(65);

  const v = verifyResearch(data, corpus);
  const enrichment: LeadEnrichment = {
    researchedAt: new Date().toISOString(),
    sourceUrl: lead.website,
    pages: crawl.pages.map((p) => p.url),
    products: data.products,
    verified: v.verified,
    assumptions: v.assumptions,
    downgraded: v.downgraded,
  };

  const social = data.socialProfiles ?? {};
  await db.lead.update({
    where: { id: leadId },
    data: {
      aiSummary: data.summary,
      enrichment: enrichment as unknown as Prisma.InputJsonValue,
      industry: lead.industry ?? data.industry,
      subIndustry: lead.subIndustry ?? data.subIndustry,
      employeeCountMin: lead.employeeCountMin ?? v.employeeCountMin,
      employeeCountMax: lead.employeeCountMax ?? v.employeeCountMax,
      // Önce sayfalarda gerçekten bulunan adres (mailto / metin / Cloudflare), sonra AI'ın bulup metinde doğrulananı
      genericEmail: lead.genericEmail ?? pickCompanyEmail(crawl.pages.flatMap((p) => p.emails), lead.website) ?? v.genericEmail,
      phone: lead.phone ?? v.phone,
      normalizedPhone: lead.normalizedPhone ?? normalizePhone(v.phone),
      linkedin: lead.linkedin ?? (social.linkedin && valueFound(social.linkedin, corpus) ? social.linkedin : null),
      instagram: lead.instagram ?? (social.instagram && valueFound(social.instagram, corpus) ? social.instagram : null),
      lastVerifiedAt: new Date(),
      nextRefreshAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000),
    },
  });

  // Sinyaller: yalnızca kanıtı sayfada bulunanlar, aynı başlık tekrar eklenmez
  for (const s of v.signals) {
    const exists = await db.leadSignal.findFirst({ where: { leadId, title: s.title } });
    if (exists) continue;
    await db.leadSignal.create({
      data: {
        companyId,
        leadId,
        type: s.type,
        title: s.title,
        description: s.description ?? null,
        sourceUrl: s.sourceUrl ?? lead.website,
        publishedAt: parseDate(s.publishedAt),
        confidence: s.confidence,
        aiInterpretation: s.evidence ? `Kaynak: "${s.evidence.slice(0, 300)}"` : null,
        verified: true,
      },
    });
  }

  await db.websiteAnalysis.create({
    data: {
      companyId,
      target: "LEAD",
      targetId: leadId,
      url: lead.website,
      status: "COMPLETED",
      pages: crawl.pages.map((p) => ({ url: p.url, title: p.title })) as unknown as Prisma.InputJsonValue,
      summary: data.summary,
      completedAt: new Date(),
    },
  });

  return { pages: crawl.pages.length, verified: v.verified.length, assumptions: v.assumptions.length, signals: v.signals.length };
}

// ── 4) Puanlama ───────────────────────────────────────────────────────

export async function startLeadScoring(ctx: TenantContext, leadIds: string[]) {
  assertCan(ctx, "lead.write");
  if (!isAIConfigured()) throw new AppError("AI_UNAVAILABLE", "AI sağlayıcısı yapılandırılmamış (.env → ANTHROPIC_API_KEY).");
  const ids = [...new Set(leadIds)].slice(0, 100);
  if (ids.length === 0) throw new AppError("VALIDATION", "Puanlanacak lead seçin.");
  const owned = await tenantDb(ctx).lead.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (owned.length === 0) throw new AppError("NOT_FOUND", "Lead bulunamadı.");

  const { usageId } = await consumeCredits({
    companyId: ctx.companyId,
    operation: "lead.score",
    quantity: owned.length,
    userId: ctx.userId,
    refType: "lead.score",
  });
  let jobId: string;
  try {
    jobId = await enqueue(
      "lead.score",
      { leadIds: owned.map((l) => l.id), usageId },
      { companyId: ctx.companyId, createdById: ctx.userId },
    );
  } catch (err) {
    await refundCredits(usageId, "lead.score.enqueue_failed");
    throw err;
  }
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "lead.scoring.started", metadata: { count: owned.length } });
  return { jobId, count: owned.length, cost: owned.length * CREDIT_COSTS["lead.score"] };
}

function leadToPrompt(lead: {
  companyName: string;
  website: string | null;
  industry: string | null;
  subIndustry: string | null;
  city: string | null;
  district: string | null;
  country: string | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  aiSummary: string | null;
  enrichment: Prisma.JsonValue;
  signals: Array<{ type: string; title: string; description: string | null; publishedAt: Date | null }>;
}) {
  const e = (lead.enrichment ?? null) as LeadEnrichment | null;
  return JSON.stringify(
    {
      companyName: lead.companyName,
      website: lead.website,
      directoryCategory: lead.industry,
      subIndustry: lead.subIndustry,
      location: [lead.district, lead.city, lead.country].filter(Boolean).join(", "),
      employees: lead.employeeCountMin || lead.employeeCountMax ? { min: lead.employeeCountMin, max: lead.employeeCountMax } : null,
      researchSummary: lead.aiSummary,
      products: e?.products ?? [],
      verifiedFacts: e?.verified.map((v) => v.statement) ?? [],
      assumptions: e?.assumptions.map((a) => a.statement) ?? [],
      verifiedSignals: lead.signals.map((s) => ({
        type: s.type,
        title: s.title,
        description: s.description,
        date: s.publishedAt?.toISOString().slice(0, 10) ?? null,
      })),
    },
    null,
    1,
  );
}

/** Tek lead'i puanlar. İş (job) içinden çağrılır; satıcı bağlamı yalnızca doğrulanmış bilgidir. */
export async function scoreLead(companyId: string, leadId: string, seller?: Awaited<ReturnType<typeof sellerContext>>) {
  const db = tenantDb({ companyId });
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      signals: { where: { verified: true }, orderBy: { detectedAt: "desc" }, take: 10 },
      _count: { select: { contacts: true } },
    },
  });
  if (!lead) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  const ctxSeller = seller ?? (await sellerContext(companyId));

  const { data, raw } = await ai({ companyId, operation: "lead.score" }).extract({
    schema: leadScoreSchema,
    tier: "fast",
    instructions: LEAD_SCORE_INSTRUCTIONS,
    shape: LEAD_SCORE_SHAPE,
    input: `ŞİRKET BAĞLAMI (satıcı, doğrulanmış):\n${ctxSeller.text}\n\nLEAD VERİSİ:\n${untrusted("lead-data", leadToPrompt(lead), 20_000)}`,
    maxTokens: 1500,
  });

  const final = finalizeScore(data, {
    verifiedSignalCount: lead.signals.length,
    hasSizeData: Boolean(lead.employeeCountMin || lead.employeeCountMax),
    researched: Boolean(lead.enrichment),
    reachability: computeReachability({
      website: lead.website,
      phone: lead.phone,
      genericEmail: lead.genericEmail,
      contactCount: lead._count.contacts,
      linkedin: lead.linkedin,
      instagram: lead.instagram,
    }),
  });

  // Ürün uydurma koruması: yalnızca şirketin onaylı ürün adları
  const allowed = new Map(ctxSeller.productNames.map((n) => [n.toLocaleLowerCase("tr"), n]));
  const matchedProducts = data.matchedProducts
    .map((p) => allowed.get(p.trim().toLocaleLowerCase("tr")))
    .filter((p): p is string => Boolean(p));

  const assumptions = [...data.assumptions];
  if (!ctxSeller.hasProducts) assumptions.unshift("Şirketin onaylı ürün listesi boş; ürün uyumu genel bilgiye göre tahmin edildi.");
  if (final.capped.length > 0) assumptions.push(`Kanıt eksikliği nedeniyle sınırlandı: ${final.capped.join(", ")}.`);
  if (data.excludedReason) assumptions.unshift(`İstenmeyen müşteri kuralı: ${data.excludedReason}`);

  const score = await db.leadScore.create({
    data: {
      companyId,
      leadId,
      total: final.total,
      productFit: final.productFit,
      industryFit: final.industryFit,
      sizeFit: final.sizeFit,
      buyingSignal: final.buyingSignal,
      reachability: final.reachability,
      explanation: data.explanation,
      verifiedFacts: { facts: data.verifiedFacts, matchedProducts } as unknown as Prisma.InputJsonValue,
      assumptions: assumptions as unknown as Prisma.InputJsonValue,
      model: raw.model,
    },
  });
  await db.lead.update({
    where: { id: leadId },
    data: {
      fitScore: final.total,
      ...(lead.status === "NEW" && final.total >= 70 && !data.excludedReason ? { status: "QUALIFIED" as const } : {}),
    },
  });
  return { scoreId: score.id, total: final.total, excluded: Boolean(data.excludedReason) };
}

/** Toplu puanlama işi: seller bağlamı bir kez hazırlanır; başarısız lead'lerin kredisi iade edilir. */
export async function scoreLeads(companyId: string, leadIds: string[], progress?: (pct: number) => Promise<void>) {
  const seller = await sellerContext(companyId);
  let ok = 0;
  const failed: string[] = [];
  for (let i = 0; i < leadIds.length; i++) {
    try {
      await scoreLead(companyId, leadIds[i]!, seller);
      ok++;
    } catch (err) {
      // AI tamamen erişilemezse iş yeniden denensin
      if (err instanceof AppError && err.code === "AI_UNAVAILABLE" && ok === 0) throw err;
      failed.push(leadIds[i]!);
    }
    await progress?.(((i + 1) / leadIds.length) * 95);
  }
  return { scored: ok, failed: failed.length };
}

/** Lead detay sayfası için: bu lead üzerinde çalışan araştırma/puanlama işi. */
export async function getActiveLeadJob(ctx: TenantContext, leadId: string) {
  assertCan(ctx, "lead.read");
  const db = tenantDb(ctx);
  const active = { in: ["QUEUED" as const, "RUNNING" as const] };
  const enrich = await db.job.findFirst({
    where: { type: "lead.enrich", status: active, payload: { path: ["leadId"], equals: leadId } },
    select: { id: true, type: true },
  });
  if (enrich) return enrich;
  return db.job.findFirst({
    where: { type: "lead.score", status: active, payload: { path: ["leadIds"], array_contains: [leadId] } },
    select: { id: true, type: true },
  });
}

/** Son başarısız araştırma hatası (kullanıcıya nedenini göstermek için). */
export async function getLastLeadJobError(ctx: TenantContext, leadId: string) {
  const job = await tenantDb(ctx).job.findFirst({
    where: { type: "lead.enrich", payload: { path: ["leadId"], equals: leadId } },
    orderBy: { createdAt: "desc" },
    select: { status: true, error: true, finishedAt: true },
  });
  return job?.status === "FAILED" ? job : null;
}

// ── 5) Web sitesinden kurumsal e-posta bulma (AI'sız, ücretsiz) ────────

const EMAIL_DISCOVERY_MAX = 50;

/**
 * Web sitesi olan ama e-postası olmayan lead'lerin sitesini (ana sayfa + iletişim) tarar ve
 * sayfada yazan kurumsal adresi (info@, satinalma@…) kaydeder. AI veya ücretli API kullanmaz → kredi düşmez.
 */
export async function startEmailDiscovery(ctx: TenantContext, leadIds: string[]) {
  assertCan(ctx, "lead.write");
  const db = tenantDb(ctx);
  const ids = [...new Set(leadIds)].slice(0, 200);
  const targets = await db.lead.findMany({
    where: { id: { in: ids }, website: { not: null }, genericEmail: null },
    select: { id: true },
    take: EMAIL_DISCOVERY_MAX,
  });
  if (targets.length === 0) throw new AppError("VALIDATION", "Web sitesi olup e-postası eksik lead yok.");
  const running = await db.job.findFirst({ where: { type: "lead.find_email", status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (running) throw new AppError("CONFLICT", "E-posta araması zaten sürüyor. Birkaç dakika sonra sayfayı yenileyin.");

  const jobId = await enqueue("lead.find_email", { leadIds: targets.map((t) => t.id) }, { companyId: ctx.companyId, createdById: ctx.userId, maxAttempts: 1 });
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "lead.email_discovery.started", metadata: { count: targets.length } });
  return { jobId, count: targets.length };
}

/** İş içinden çağrılır. Bir sitenin hatası diğerlerini durdurmaz. */
export type EmailDiscoveryOutcome = "found" | "notFound" | "blocked" | "failed";
export interface EmailDiscoveryItem {
  leadId: string;
  name: string;
  outcome: EmailDiscoveryOutcome;
  /** Bulunan kurumsal adres (yalnızca "found") */
  email?: string;
  /** Kullanıcıya gösterilen neden (kişisel adresler yazılmaz — yalnızca türü söylenir) */
  reason?: string;
}

export async function findLeadEmails(companyId: string, leadIds: string[], progress?: (pct: number) => Promise<void>) {
  const db = tenantDb({ companyId });
  const items: EmailDiscoveryItem[] = [];
  for (const [i, leadId] of leadIds.entries()) {
    const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true, companyName: true, website: true, genericEmail: true } });
    if (!lead?.website || lead.genericEmail) continue;
    const base = { leadId, name: lead.companyName };
    if (SOCIAL_HOST.test(hostOf(lead.website))) {
      items.push({ ...base, outcome: "notFound", reason: "Web sitesi yerine sosyal medya sayfası kayıtlı; sosyal medya taranmaz." });
      await progress?.(Math.round(((i + 1) / leadIds.length) * 100));
      continue;
    }
    try {
      const crawl = await crawlSite(lead.website, { maxPages: 3, ensureContactPage: true, allowPrivateHosts: allowPrivateFetch() });
      const seen = [...new Set(crawl.pages.flatMap((p) => p.emails))];
      const email = pickCompanyEmail(seen, lead.website);
      if (email) {
        // Bu arada elle girilmiş adres varsa üzerine yazılmaz
        const res = await db.lead.updateMany({ where: { id: leadId, genericEmail: null }, data: { genericEmail: email } });
        if (res.count) items.push({ ...base, outcome: "found", email });
      } else {
        items.push({ ...base, outcome: "notFound", reason: whyNoEmail(seen, lead.website, crawl.pages.length) });
      }
    } catch (err) {
      // robots.txt yasağı ayrı sayılır: site açık ama taranmamızı istemiyor (buna uyulur)
      if (err instanceof FetchBlockedError) items.push({ ...base, outcome: "blocked", reason: "Site robots.txt ile otomatik taramayı yasaklıyor." });
      else items.push({ ...base, outcome: "failed", reason: (err as Error).message.slice(0, 200) });
    }
    await progress?.(Math.round(((i + 1) / leadIds.length) * 100));
  }
  const count = (o: EmailDiscoveryOutcome) => items.filter((x) => x.outcome === o).length;
  return { found: count("found"), notFound: count("notFound"), blocked: count("blocked"), failed: count("failed"), items };
}

/** Dizinlerde web sitesi yerine girilen sosyal medya / pazaryeri adresleri (taranmaz; kendi robots kuralları da yasaklar) */
const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|wa\.me|whatsapp\.com|sahibinden\.com|trendyol\.com|hepsiburada\.com|n11\.com|google\.com|business\.site|linktr\.ee)$/i;

/** extractDomain sosyal medyada bilerek null döner; burada ham host gerekir */
function hostOf(website: string): string {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Sitede adres varsa neden seçilmediğini adresi yazmadan açıklar */
function whyNoEmail(seen: string[], website: string, pages: number): string {
  if (seen.length === 0) return `Taranan ${pages} sayfada e-posta adresi yok (iletişim formu kullanıyor olabilir).`;
  const site = extractDomain(website);
  const sameDomain = seen.filter((e) => site && (e.endsWith(`@${site}`) || e.endsWith(`.${site}`)));
  if (sameDomain.length) return "Sitede yalnızca kişiye ait adres var; kişisel adresler otomatik alınmaz.";
  const domains = [...new Set(seen.map((e) => e.split("@")[1]).filter(Boolean))].slice(0, 2).join(", ");
  return `Sitedeki adres başka bir alan adına ait (${domains}) — grup şirketi veya ajans olabilir.`;
}

/** Son 24 saatteki e-posta araması (liste üstünde özet / ilerleme için) */
export async function getLastEmailDiscovery(ctx: TenantContext) {
  const job = await tenantDb(ctx).job.findFirst({
    where: { type: "lead.find_email", createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, payload: true, result: true, error: true, finishedAt: true },
  });
  if (!job) return null;
  const total = ((job.payload as { leadIds?: string[] } | null)?.leadIds ?? []).length;
  const r = (job.result ?? {}) as { found?: number; notFound?: number; blocked?: number; failed?: number; items?: EmailDiscoveryItem[] };
  // Sonuç listesi güncel kalsın: silinen lead'ler çıkar, sonradan elle eklenen adres gösterilir
  const raw = r.items ?? [];
  const current = raw.length
    ? await tenantDb(ctx).lead.findMany({ where: { id: { in: raw.map((x) => x.leadId) } }, select: { id: true, genericEmail: true } })
    : [];
  const emailById = new Map(current.map((l) => [l.id, l.genericEmail]));
  const items = raw.filter((x) => emailById.has(x.leadId)).map((x) => ({ ...x, currentEmail: emailById.get(x.leadId) ?? null }));
  return {
    id: job.id,
    status: job.status,
    finishedAt: job.finishedAt,
    error: job.error,
    total,
    found: r.found ?? 0,
    notFound: r.notFound ?? 0,
    blocked: r.blocked ?? 0,
    failed: r.failed ?? 0,
    items,
  };
}
