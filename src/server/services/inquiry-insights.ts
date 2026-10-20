import "server-only";
import { simpleParser, type AddressObject } from "mailparser";
import type { FactStatus, Prisma } from "@prisma/client";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { assertCan } from "@/server/tenancy/permissions";
import type { TenantContext } from "@/server/tenancy/types";
import { ai, isAIConfigured } from "@/server/ai";
import { untrusted } from "@/server/ai/guardrails";
import { INQUIRY_INSTRUCTIONS, INQUIRY_SHAPE, inquiryBatchSchema } from "@/server/ai/prompts/inquiry";
import { createMailboxSinceReader, type ImapAccount, type MailboxSinceReader } from "@/server/providers/email/imap";
import { decryptSecret, encryptSecret } from "@/server/security/secrets";
import { enqueue } from "@/server/jobs/queue";
import { consumeCredits, refundCredits } from "@/server/usage/credits";
import { audit } from "@/server/audit/audit";
import { AppError, isAppError } from "@/lib/errors";
import { extractDomain } from "@/lib/lead-normalize";
import type { InquiryMailboxInput } from "@/lib/validation";
import { stripQuotedReply } from "./conversations";
import { getSenderSettings } from "./email-settings";

/**
 * Teklif kutusu analizi: firmanın kendi teklif kutusu SALT OKUNUR okunur, gelen talepler AI ile özetlenir
 * ("kimler, hangi sektörden, hangi yay için teklif istemiş"). Yalnızca hedefleme raporu içindir:
 * bu kayıtlardan lead oluşturulmaz, bu kutudan e-posta gönderilmez, kutuda hiçbir şey değiştirilmez.
 * AI'ya giden metinde e-posta adresleri ve telefonlar maskelenir; ileti metni saklanmaz.
 */

const KEY = { type: "EMAIL_PROVIDER" as const, provider: "inquiry_mailbox" };
const LOOKBACK_DAYS = 730;
const MAX_MESSAGES = 400;
const BATCH = 8;
const BODY_CHARS = 2000;

let readerOverride: ((acc: ImapAccount) => MailboxSinceReader) | null = null;
/** Testlerde gerçek IMAP yerine sahte okuyucu */
export function __setInquiryReaderForTests(f: ((acc: ImapAccount) => MailboxSinceReader) | null) {
  readerOverride = f;
}
const readerFor = (acc: ImapAccount) => (readerOverride ?? createMailboxSinceReader)(acc);

interface StoredConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
}

// ── Bağlantı ayarları ──────────────────────────────────────────────────

export async function getInquiryMailbox(ctx: TenantContext) {
  assertCan(ctx, "email.settings");
  const rec = await tenantDb(ctx).integration.findFirst({ where: KEY });
  if (!rec?.config) return null;
  const c = rec.config as unknown as StoredConfig;
  return { host: c.host, port: c.port, secure: c.secure, user: c.user, mailbox: c.mailbox, status: rec.status, lastCheckedAt: rec.lastCheckedAt, lastError: rec.lastError };
}

/** IMAP hatasını kullanıcıya anlaşılır nedene çevirir (şifre / sunucu / klasör) */
export function describeImapError(err: unknown): string {
  const e = err as { message?: string; code?: string; authenticationFailed?: boolean; responseText?: string };
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.responseText ?? ""}`;
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|authentication|invalid credentials|LOGIN failed/i.test(text)) return "Kullanıcı adı veya şifre hatalı.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) return "Sunucu adresi bulunamadı. IMAP sunucusunu kontrol edin.";
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(text)) return "Sunucuya bağlanılamadı. Port ve SSL ayarını kontrol edin (genelde 993 + SSL).";
  if (/certificate|self.signed|CERT_/i.test(text)) return "Sunucunun SSL sertifikası doğrulanamadı. Barındırma firmasının verdiği sunucu adını kullanın.";
  if (/NONEXISTENT|Mailbox doesn't exist|not found/i.test(text)) return "Klasör bulunamadı (genelde INBOX).";
  return `Posta kutusuna bağlanılamadı: ${(e?.message ?? "bilinmeyen hata").slice(0, 160)}`;
}

/** Ayarları kaydeder; önce bağlantı denenir. Şifre şifrelenmiş saklanır, boş bırakılırsa eskisi korunur. */
export async function saveInquiryMailbox(ctx: TenantContext, input: InquiryMailboxInput) {
  assertCan(ctx, "email.settings");
  const db = tenantDb(ctx);
  const existing = await db.integration.findFirst({ where: KEY });
  const pass = input.pass || (existing?.secretsEncrypted ? decryptSecret(existing.secretsEncrypted) : "");
  if (!pass) throw new AppError("VALIDATION", "Şifre gerekli.", { pass: "Şifre gerekli" });
  const config: StoredConfig = { host: input.host, port: input.port, secure: input.secure, user: input.user, mailbox: input.mailbox };

  let messages: number;
  try {
    ({ messages } = await readerFor({ ...config, pass }).check());
  } catch (err) {
    throw new AppError("VALIDATION", describeImapError(err));
  }

  const data = {
    name: "Teklif kutusu (yalnızca analiz)",
    config: config as unknown as Prisma.InputJsonValue,
    secretsEncrypted: encryptSecret(pass),
    status: "ACTIVE" as const,
    lastCheckedAt: new Date(),
    lastError: null,
  };
  if (existing) await db.integration.update({ where: { id: existing.id }, data });
  else await db.integration.create({ data: { ...KEY, companyId: ctx.companyId, ...data } });
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "inquiry_mailbox.saved", metadata: { host: input.host, user: input.user } });
  return { messages };
}

export async function deleteInquiryMailbox(ctx: TenantContext) {
  assertCan(ctx, "email.settings");
  const res = await tenantDb(ctx).integration.deleteMany({ where: KEY });
  if (res.count) await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "inquiry_mailbox.deleted" });
}

// ── Analiz ─────────────────────────────────────────────────────────────

export async function startInquiryAnalysis(ctx: TenantContext) {
  assertCan(ctx, "email.settings");
  if (!isAIConfigured()) throw new AppError("AI_UNAVAILABLE", "Analiz için AI gerekli (sunucuda AI yapılandırılmamış).");
  const db = tenantDb(ctx);
  const mailbox = await db.integration.findFirst({ where: KEY, select: { id: true } });
  if (!mailbox) throw new AppError("VALIDATION", "Önce teklif kutusunun bağlantı bilgilerini kaydedin.");
  const running = await db.job.findFirst({ where: { type: "inquiry.analyze", status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (running) throw new AppError("CONFLICT", "Analiz zaten sürüyor. Birkaç dakika sonra sayfayı yenileyin.");
  const jobId = await enqueue("inquiry.analyze", {}, { companyId: ctx.companyId, createdById: ctx.userId, maxAttempts: 1 });
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "inquiry.analysis.started" });
  return { jobId };
}

/** AI'ya gitmeden önce kişisel iletişim bilgileri maskelenir. Saf fonksiyon. */
export function redactPersonalData(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-posta]")
    .replace(/\+\d[\d\s().-]{8,16}\d/g, "[telefon]")
    // 0532 111 22 33 · (332) 111-22-33 · 3321112233 — adet aralıkları (100.000-200.000) eşleşmez
    .replace(/(?<!\d)0?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g, "[telefon]");
}

/** Otomatik / toplu ileti mi (otomatik yanıt, bülten, sistem bildirimi)? Saf fonksiyon. */
export function isAutomatedMail(headers: Map<string, unknown>, from: string): boolean {
  const auto = String(headers.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return true;
  if (/^(bulk|list|junk)$/i.test(String(headers.get("precedence") ?? ""))) return true;
  return /^(no-?reply|mailer-daemon|postmaster|bounce|notification)/i.test(from.split("@")[0] ?? "");
}

const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

export interface InquiryRunResult {
  read: number;
  alreadyProcessed: number;
  skipped: number;
  analyzed: number;
  inquiries: number;
  /** Kategori eklenmeden önce işlenip yeniden sınıflandırılan talepler */
  reclassified: number;
  stoppedForCredits: boolean;
}

/** İş içinden çağrılır. Daha önce işlenen iletiler atlanır (AI maliyeti tekrarlanmaz). */
export async function runInquiryAnalysis(companyId: string, progress?: (pct: number) => Promise<void>): Promise<InquiryRunResult> {
  const db = tenantDb({ companyId });
  const rec = await db.integration.findFirst({ where: KEY });
  if (!rec?.config || !rec.secretsEncrypted) throw new AppError("VALIDATION", "Teklif kutusu bağlantısı tanımlı değil.");
  const cfg = rec.config as unknown as StoredConfig;

  let batch: Awaited<ReturnType<MailboxSinceReader["readSince"]>>;
  try {
    batch = await readerFor({ ...cfg, pass: decryptSecret(rec.secretsEncrypted) }).readSince(new Date(Date.now() - LOOKBACK_DAYS * 86_400_000), MAX_MESSAGES);
  } catch (err) {
    const msg = describeImapError(err);
    await db.integration.update({ where: { id: rec.id }, data: { status: "ERROR", lastError: msg, lastCheckedAt: new Date() } });
    throw new AppError("VALIDATION", msg);
  }
  await progress?.(10);

  const keyOf = (uid: number) => `${batch.uidValidity}:${uid}`;
  const existing = await db.inboundInquiry.findMany({
    where: { sourceKey: { in: batch.messages.map((m) => keyOf(m.uid)) } },
    select: { sourceKey: true, isInquiry: true, category: true, status: true },
  });
  // Kategori alanı eklenmeden önce işlenen talepler yeniden sınıflandırılır (durumları korunur)
  const redo = new Map(existing.filter((r) => r.isInquiry && !r.category).map((r) => [r.sourceKey, r.status]));
  const done = new Set(existing.filter((r) => !redo.has(r.sourceKey)).map((r) => r.sourceKey));

  // Firmanın kendi alan adlarından gelenler (kendi gönderdiği teklifler, iç yazışma) talep değildir
  const { settings } = await getSenderSettings(companyId);
  const company = await db.company.findUnique({ where: { id: companyId }, select: { website: true } });
  const own = new Set(
    [cfg.user, settings?.fromEmail, settings?.replyTo].map((a) => a?.split("@")[1]?.toLowerCase()).concat(extractDomain(company?.website ?? "") ?? undefined).filter(Boolean) as string[],
  );

  const result: InquiryRunResult = { read: batch.messages.length, alreadyProcessed: done.size, skipped: 0, analyzed: 0, inquiries: 0, reclassified: 0, stoppedForCredits: false };
  const skippedRows: Prisma.InboundInquiryCreateManyInput[] = [];
  const candidates: Array<{ sourceKey: string; receivedAt: Date | null; senderDomain: string | null; text: string }> = [];

  for (const m of batch.messages) {
    const sourceKey = keyOf(m.uid);
    if (done.has(sourceKey)) continue;
    let parsed: Awaited<ReturnType<typeof simpleParser>>;
    try {
      parsed = await simpleParser(m.source);
    } catch {
      continue; // bozuk ileti: atlanır, bir sonraki çalıştırmada yeniden denenir
    }
    const from = ((parsed.from as AddressObject | undefined)?.value?.[0]?.address ?? "").toLowerCase();
    const senderDomain = from.split("@")[1] ?? null;
    const receivedAt = parsed.date ?? null;
    if (!from || (senderDomain && own.has(senderDomain)) || isAutomatedMail(parsed.headers as Map<string, unknown>, from)) {
      skippedRows.push({ companyId, sourceKey, receivedAt, senderDomain, isInquiry: false });
      continue;
    }
    const body = stripQuotedReply(parsed.text ?? "").slice(0, BODY_CHARS);
    candidates.push({ sourceKey, receivedAt, senderDomain, text: redactPersonalData(`Konu: ${parsed.subject ?? ""}\n${body}`) });
  }
  if (skippedRows.length) await db.inboundInquiry.createMany({ data: skippedRows, skipDuplicates: true });
  result.skipped = skippedRows.length;
  await progress?.(20);

  for (let i = 0; i < candidates.length; i += BATCH) {
    const group = candidates.slice(i, i + BATCH);
    let usageId: string;
    try {
      ({ usageId } = await consumeCredits({ companyId, operation: "inquiry.analyze", refType: "InboundInquiry" }));
    } catch (err) {
      if (isAppError(err) && err.code === "INSUFFICIENT_CREDITS") {
        result.stoppedForCredits = true;
        break; // işlenenler kaydedildi; kredi yüklenince kalanlar devam eder
      }
      throw err;
    }
    let items: Awaited<ReturnType<typeof extractBatch>>;
    try {
      items = await extractBatch(companyId, group.map((g) => g.text));
    } catch (err) {
      await refundCredits(usageId, "inquiry.analyze.failed");
      throw err;
    }
    const rows: Prisma.InboundInquiryCreateManyInput[] = [];
    for (const [idx, g] of group.entries()) {
      const it = items.find((x) => x.n === idx + 1);
      if (!it) continue; // AI atladı: kaydedilmez, sonraki çalıştırmada tekrar denenir
      const hay = norm(g.text);
      // Kanıt ve firma adı iletide birebir geçmiyorsa uydurma sayılır, kaydedilmez
      const evidence = it.evidence && hay.includes(norm(it.evidence)) ? it.evidence : null;
      const companyName = it.companyName && hay.includes(norm(it.companyName)) ? it.companyName : null;
      const isInquiry = it.isInquiry && Boolean(evidence);
      rows.push({
        companyId,
        sourceKey: g.sourceKey,
        receivedAt: g.receivedAt,
        senderDomain: g.senderDomain,
        isInquiry,
        ...(isInquiry
          ? {
              companyName,
              category: it.category ?? "Diğer",
              purpose: it.purpose,
              sector: it.sector,
              application: it.application,
              springTypes: it.springTypes,
              quantity: it.quantity,
              city: it.city,
              country: it.country,
              evidence,
              status: redo.get(g.sourceKey) ?? "PENDING",
            }
          : {}),
      });
      if (isInquiry) result.inquiries++;
    }
    const replaced = rows.map((r) => r.sourceKey).filter((k) => redo.has(k));
    if (replaced.length) await db.inboundInquiry.deleteMany({ where: { sourceKey: { in: replaced } } });
    result.reclassified += replaced.length;
    await db.inboundInquiry.createMany({ data: rows, skipDuplicates: true });
    result.analyzed += rows.length;
    await progress?.(20 + Math.round(((i + group.length) / candidates.length) * 80));
  }
  await db.integration.update({ where: { id: rec.id }, data: { status: "ACTIVE", lastError: null, lastCheckedAt: new Date() } });
  return result;
}

async function extractBatch(companyId: string, texts: string[]) {
  const input = texts.map((t, i) => `İLETİ ${i + 1}:\n${t}`).join("\n\n---\n\n");
  const { data } = await ai({ companyId, operation: "inquiry.analyze" }).extract({
    schema: inquiryBatchSchema,
    instructions: INQUIRY_INSTRUCTIONS,
    shape: INQUIRY_SHAPE,
    input: untrusted("inquiry-mailbox", input, BATCH * (BODY_CHARS + 300)),
    tier: "fast",
    maxTokens: 3000,
  });
  return data.items;
}

// ── Rapor ──────────────────────────────────────────────────────────────

const countBy = (values: Array<string | null | undefined>) => {
  const map = new Map<string, { name: string; count: number }>();
  for (const v of values) {
    const name = v?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("tr");
    const e = map.get(key) ?? { name, count: 0 };
    e.count++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
};

export async function getInquiryReport(ctx: TenantContext) {
  assertCan(ctx, "campaign.read");
  const db = tenantDb(ctx);
  const [total, inquiries] = await Promise.all([
    db.inboundInquiry.count(),
    db.inboundInquiry.findMany({ where: { isInquiry: true }, orderBy: { receivedAt: "desc" }, take: 500 }),
  ]);
  const counted = inquiries.filter((q) => q.status !== "REJECTED");
  return {
    total,
    inquiries: counted.length,
    rejected: inquiries.length - counted.length,
    byCategory: countBy(counted.map((q) => q.category ?? "Sınıflandırılmamış")),
    byPurpose: countBy(counted.map((q) => q.purpose ?? "belirsiz")),
    serial: counted.filter((q) => q.purpose === "seri üretim").length,
    maintenance: counted.filter((q) => q.purpose === "bakım-onarım").length,
    bySpringType: countBy(counted.flatMap((q) => q.springTypes)),
    byCity: countBy(counted.map((q) => q.city ?? q.country)),
    items: inquiries,
  };
}

/** Yanlış çıkarılan talebi rapordan çıkarır (REJECTED) veya geri alır */
export async function setInquiryStatus(ctx: TenantContext, id: string, status: FactStatus) {
  assertCan(ctx, "campaign.write");
  const res = await tenantDb(ctx).inboundInquiry.updateMany({ where: { id, isInquiry: true }, data: { status } });
  if (res.count === 0) throw new AppError("NOT_FOUND", "Kayıt bulunamadı.");
  await audit({ companyId: ctx.companyId, userId: ctx.userId, action: "inquiry.status_changed", entityType: "InboundInquiry", entityId: id, metadata: { status } });
}

export async function getLastInquiryAnalysis(ctx: TenantContext) {
  assertCan(ctx, "campaign.read");
  return tenantDb(ctx).job.findFirst({
    where: { type: "inquiry.analyze" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, result: true, error: true, finishedAt: true, createdAt: true },
  });
}
