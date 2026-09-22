import "server-only";
import type { LeadStatus, Prisma } from "@prisma/client";
import { tenantDb, type TenantDb } from "@/server/tenancy/tenant-db";
import { assertCan } from "@/server/tenancy/permissions";
import type { TenantContext } from "@/server/tenancy/types";
import { audit } from "@/server/audit/audit";
import { AppError } from "@/lib/errors";
import {
  extractDomain,
  isCompanyEmail,
  isGenericEmail,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "@/lib/lead-normalize";
import type { RawLead } from "@/server/providers/lead-source/types";
import { emitEvent } from "./integrations";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Yeni",
  RESEARCHING: "Araştırılıyor",
  QUALIFIED: "Uygun",
  CONTACT_READY: "İletişime hazır",
  CONTACTED: "İletişim kuruldu",
  REPLIED: "Yanıt verdi",
  INTERESTED: "İlgileniyor",
  QUALIFIED_OPPORTUNITY: "Fırsat",
  QUOTE_REQUESTED: "Teklif istedi",
  PROPOSAL_SENT: "Teklif gönderildi",
  NEGOTIATION: "Görüşme",
  WON: "Kazanıldı",
  LOST: "Kaybedildi",
  NURTURE: "Besleme",
  SUPPRESSED: "Engellendi",
};

export interface LeadFilter {
  q?: string;
  status?: LeadStatus;
  city?: string;
  minScore?: number;
  /** Yalnızca puanlanmamış lead'ler */
  unscored?: boolean;
  take?: number;
  skip?: number;
}

function buildWhere(filter: LeadFilter): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.city) where.city = { equals: filter.city, mode: "insensitive" };
  if (typeof filter.minScore === "number") where.fitScore = { gte: filter.minScore };
  if (filter.unscored) where.fitScore = null;
  if (filter.q) {
    const q = filter.q.trim();
    where.OR = [
      { companyName: { contains: q, mode: "insensitive" } },
      { normalizedName: { contains: normalizeCompanyName(q) } },
      { domain: { contains: q.toLowerCase() } },
      { city: { contains: q, mode: "insensitive" } },
      { industry: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function listLeads(ctx: TenantContext, filter: LeadFilter = {}) {
  assertCan(ctx, "lead.read");
  const db = tenantDb(ctx);
  const where = buildWhere(filter);
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
      take: Math.min(filter.take ?? 50, 200),
      skip: filter.skip ?? 0,
      include: {
        _count: { select: { contacts: true, signals: true } },
        sources: { select: { type: true, provider: true }, take: 3 },
      },
    }),
    db.lead.count({ where }),
  ]);
  return { rows, total };
}

export async function leadStats(ctx: TenantContext) {
  assertCan(ctx, "lead.read");
  const db = tenantDb(ctx);
  const [total, scored, qualified, contactReady] = await Promise.all([
    db.lead.count(),
    db.lead.count({ where: { fitScore: { not: null } } }),
    db.lead.count({ where: { fitScore: { gte: 70 } } }),
    db.lead.count({ where: { status: { in: ["CONTACT_READY", "QUALIFIED"] } } }),
  ]);
  return { total, scored, qualified, contactReady };
}

export async function getLead(ctx: TenantContext, id: string) {
  assertCan(ctx, "lead.read");
  const lead = await tenantDb(ctx).lead.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      sources: { orderBy: { fetchedAt: "desc" } },
      signals: { orderBy: [{ publishedAt: "desc" }, { detectedAt: "desc" }] },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!lead) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  return lead;
}

export async function updateLeadStatus(ctx: TenantContext, id: string, status: LeadStatus) {
  assertCan(ctx, "lead.write");
  const res = await tenantDb(ctx).lead.updateMany({
    where: { id },
    data: { status, suppressed: status === "SUPPRESSED" },
  });
  if (res.count === 0) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  await audit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "lead.status_changed",
    entityType: "Lead",
    entityId: id,
    metadata: { status },
  });
}

/**
 * Kurumsal iletişim bilgilerini elle düzeltir (ör. robots.txt ile taramayı yasaklayan sitedeki adresi
 * kullanıcı kendisi okuyup girer). Kişisel adresler buraya yazılmaz — KVKK: kişiler ayrı tutulur.
 */
export async function updateLeadContactInfo(ctx: TenantContext, input: { id: string; website?: string | null; phone?: string | null; genericEmail?: string | null }) {
  assertCan(ctx, "lead.write");
  const db = tenantDb(ctx);
  const lead = await db.lead.findUnique({ where: { id: input.id }, select: { id: true, website: true } });
  if (!lead) throw new AppError("NOT_FOUND", "Lead bulunamadı.");

  const website = input.website?.trim() || null;
  const domain = website ? extractDomain(website) : null;
  if (website && !domain) throw new AppError("VALIDATION", "Web adresi geçersiz.", { website: "Geçersiz adres" });
  const phone = input.phone?.trim() || null;
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (phone && !normalizedPhone) throw new AppError("VALIDATION", "Telefon numarası geçersiz.", { phone: "Geçersiz numara" });
  const email = input.genericEmail?.trim() ? normalizeEmail(input.genericEmail) : null;
  if (input.genericEmail?.trim() && !email) throw new AppError("VALIDATION", "E-posta adresi geçersiz.", { genericEmail: "Geçersiz adres" });
  if (email && !isCompanyEmail(email, website ?? lead.website)) {
    throw new AppError("VALIDATION", "Bu adres bir kişiye ait görünüyor. Buraya yalnızca kurumsal adres girin (info@, satis@, satinalma@…).", {
      genericEmail: "Kişisel adres",
    });
  }

  await db.lead.update({
    where: { id: lead.id },
    data: { website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null, domain, phone, normalizedPhone, genericEmail: email },
  });
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "lead.contact_updated", entityType: "Lead", entityId: lead.id, metadata: { website: Boolean(website), phone: Boolean(phone), email: Boolean(email) } });
}

export async function deleteLead(ctx: TenantContext, id: string) {
  assertCan(ctx, "lead.write");
  const res = await tenantDb(ctx).lead.deleteMany({ where: { id } });
  if (res.count === 0) throw new AppError("NOT_FOUND", "Lead bulunamadı.");
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "lead.deleted", entityType: "Lead", entityId: id });
}

// ── Dedupe + kaydetme ────────────────────────────────────────────────

/** Ham lead'den DB alanlarını türetir (normalize edilmiş dedupe anahtarları dahil). */
export function rawToLeadData(raw: RawLead) {
  return {
    companyName: raw.companyName.trim().slice(0, 300),
    normalizedName: normalizeCompanyName(raw.companyName),
    domain: extractDomain(raw.website),
    website: raw.website?.trim().slice(0, 500) ?? null,
    phone: raw.phone?.trim().slice(0, 50) ?? null,
    normalizedPhone: normalizePhone(raw.phone),
    genericEmail: normalizeEmail(raw.genericEmail),
    address: raw.address?.trim().slice(0, 500) ?? null,
    city: raw.city?.trim().slice(0, 120) ?? null,
    district: raw.district?.trim().slice(0, 120) ?? null,
    country: raw.country?.trim().slice(0, 120) ?? "TR",
    industry: raw.category?.trim().slice(0, 200) ?? null,
    instagram: raw.socialProfiles?.instagram ?? null,
    linkedin: raw.socialProfiles?.linkedin ?? null,
    facebook: raw.socialProfiles?.facebook ?? null,
  };
}

/**
 * Mevcut lead'i bulur: alan adı → normalize telefon → normalize firma adı (+ şehir).
 * Farklı kaynaklardan gelse de aynı firma iki kez yazılmaz (spec §36 dedupe).
 */
async function findDuplicate(db: TenantDb, data: ReturnType<typeof rawToLeadData>) {
  const or: Prisma.LeadWhereInput[] = [];
  if (data.domain) or.push({ domain: data.domain });
  if (data.normalizedPhone) or.push({ normalizedPhone: data.normalizedPhone });
  // slugify boş/Latin dışı adlarda "sirket" döner — bu anahtarla eşleştirme yanlış birleştirme yapar
  if (data.normalizedName && data.normalizedName.length >= 3 && data.normalizedName !== "sirket") {
    or.push(
      data.city
        ? { normalizedName: data.normalizedName, city: { equals: data.city, mode: "insensitive" } }
        : { normalizedName: data.normalizedName },
    );
  }
  if (or.length === 0) return null;
  return db.lead.findFirst({ where: { OR: or }, orderBy: { createdAt: "asc" } });
}

/** Boş olan alanları doldurur; dolu alanların üzerine yazmaz. */
function fillMissing(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === "") continue;
    const current = existing[key];
    if (current === null || current === undefined || current === "") patch[key] = value;
  }
  return patch;
}

export interface SaveLeadsResult {
  created: number;
  merged: number;
  skipped: number;
  leadIds: string[];
}

/**
 * Kaynaktan gelen lead'leri dedupe ederek kaydeder. İş (job) bağlamında da çalışır:
 * kullanıcı rolü yoktur, yetki kontrolü çağıran taraftadır.
 */
export async function saveDiscoveredLeads(
  companyId: string,
  raws: RawLead[],
  opts: { provider: string; runId?: string },
): Promise<SaveLeadsResult> {
  const db = tenantDb({ companyId });
  const result: SaveLeadsResult = { created: 0, merged: 0, skipped: 0, leadIds: [] };

  for (const raw of raws) {
    if (!raw.companyName?.trim()) {
      result.skipped++;
      continue;
    }
    const data = rawToLeadData(raw);
    const existing = await findDuplicate(db, data);

    let leadId: string;
    if (existing) {
      const patch = fillMissing(existing as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      if (Object.keys(patch).length > 0) {
        await db.lead.update({ where: { id: existing.id }, data: patch as Prisma.LeadUpdateInput });
      }
      leadId = existing.id;
      result.merged++;
    } else {
      const created = await db.lead.create({ data: { ...data, companyId, status: "NEW" } });
      leadId = created.id;
      result.created++;
    }
    result.leadIds.push(leadId);

    // Kaynak kaydı: aynı sağlayıcı + externalId tekrar eklenmez
    const already = raw.externalId
      ? await db.leadSource.findFirst({ where: { leadId, provider: opts.provider, externalId: raw.externalId } })
      : null;
    if (!already) {
      await db.leadSource.create({
        data: {
          companyId,
          leadId,
          type: raw.sourceType,
          provider: opts.provider,
          externalId: raw.externalId ?? null,
          sourceUrl: raw.sourceUrl ?? null,
          rawData: (raw.raw ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }

    await saveContacts(db, companyId, leadId, raw);
  }

  await audit({
    companyId,
    actorType: "SYSTEM",
    action: "lead.discovered",
    metadata: {
      provider: opts.provider,
      runId: opts.runId ?? null,
      created: result.created,
      merged: result.merged,
      skipped: result.skipped,
      leadIds: result.leadIds.slice(0, 50),
    },
  });
  // Toplu ekleme tek olay olarak yayınlanır (tek tek elle eklemede "lead.created" ayrıca yayınlanır)
  if (result.created > 0 && opts.provider !== "manual") {
    await emitEvent(companyId, "leads.imported", { source: opts.provider, created: result.created, merged: result.merged, leadIds: result.leadIds.slice(0, 100) });
  }
  return result;
}

/**
 * Kişisel iletişim bilgileri ayrı kayıtta tutulur; hukuki dayanak varsayılan NONE'dur
 * (gönderim öncesi uyum kontrolü Faz 3'te bu alanı kullanır).
 */
async function saveContacts(db: TenantDb, companyId: string, leadId: string, raw: RawLead) {
  for (const c of raw.personalContacts ?? []) {
    const email = normalizeEmail(c.email);
    const phone = normalizePhone(c.phone);
    if (!email && !phone && !c.fullName) continue;
    const orFilters: Prisma.LeadContactWhereInput[] = [];
    if (email) orFilters.push({ email });
    if (phone) orFilters.push({ phone });
    const exists = orFilters.length > 0 ? await db.leadContact.findFirst({ where: { leadId, OR: orFilters } }) : null;
    if (exists) continue;
    await db.leadContact.create({
      data: {
        companyId,
        leadId,
        type: isGenericEmail(email) ? "COMPANY_GENERIC" : "PERSONAL",
        fullName: c.fullName?.slice(0, 200) ?? null,
        title: c.title?.slice(0, 200) ?? null,
        email,
        phone,
        source: raw.sourceType,
        sourceUrl: c.sourceUrl ?? raw.sourceUrl ?? null,
        sourceDate: new Date(),
      },
    });
  }
}

/** Elle lead ekleme — dedupe aynı kurallarla çalışır. */
export async function createManualLead(ctx: TenantContext, raw: RawLead) {
  assertCan(ctx, "lead.write");
  const res = await saveDiscoveredLeads(ctx.companyId, [raw], { provider: "manual" });
  const leadId = res.leadIds[0];
  if (!leadId) throw new AppError("VALIDATION", "Lead kaydedilemedi: firma adı gerekli.");
  await audit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "lead.created_manual",
    entityType: "Lead",
    entityId: leadId,
  });
  if (res.created > 0) await emitEvent(ctx.companyId, "lead.created", { leadId, companyName: raw.companyName });
  return { leadId, merged: res.merged > 0 };
}

/** Sinyaller sayfası: tüm lead'lerdeki doğrulanmış satış sinyalleri, en yeniden eskiye. */
export async function listRecentSignals(ctx: TenantContext, take = 100) {
  assertCan(ctx, "lead.read");
  return tenantDb(ctx).leadSignal.findMany({
    where: { verified: true },
    orderBy: { detectedAt: "desc" },
    take: Math.min(take, 200),
    include: { lead: { select: { id: true, companyName: true, city: true, fitScore: true } } },
  });
}
