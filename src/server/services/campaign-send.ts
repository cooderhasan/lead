import "server-only";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { env } from "@/server/env";
import { getEmailProvider } from "@/server/providers/email";
import type { OutgoingEmail } from "@/server/providers/email/types";
import { audit } from "@/server/audit/audit";
import { AppError } from "@/lib/errors";
import { findSuppression, refreshLeadCompliance } from "./compliance";
import { getSenderSettings, type SenderSettings } from "./email-settings";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "./unsubscribe";

const CONTACTED_FROM = ["NEW", "RESEARCHING", "QUALIFIED", "CONTACT_READY"] as const;
const THROTTLE_MS = () => (process.env.NODE_ENV === "test" ? 0 : 1500);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Gönderici kimliği + ret bağlantısı içeren alt bilgi (6563 s.K.: gönderici kimliği ve ret hakkı).
 * Mesaj gövdesine her gönderimde sistem ekler; kullanıcı/AI bunu kaldıramaz.
 */
export function buildEmailContent(body: string, sender: SenderSettings, unsubscribe: string) {
  const footerLines = [
    sender.signature?.trim() || sender.fromName,
    sender.legalName,
    sender.postalAddress,
    sender.phone ?? null,
  ].filter(Boolean) as string[];
  const legal = `Bu ileti ${sender.legalName} tarafından ticari amaçla gönderilmiştir. Almak istemiyorsanız: ${unsubscribe}`;
  const text = `${body.trim()}\n\n--\n${footerLines.join("\n")}\n\n${legal}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${escapeHtml(body.trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}<p style="margin:20px 0 0;color:#555">--<br>${footerLines.map(escapeHtml).join("<br>")}</p><p style="margin:16px 0 0;font-size:12px;color:#888">Bu ileti ${escapeHtml(sender.legalName)} tarafından ticari amaçla gönderilmiştir. <a href="${escapeHtml(unsubscribe)}" style="color:#888">E-posta almayı durdur</a></p></div>`;
  return { text, html };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface SendRunResult {
  sent: number;
  failed: number;
  skipped: number;
  remainingApproved: number;
  quotaReached: boolean;
  paused: boolean;
}

/**
 * Onaylı mesajları gönderir. Her mesajdan hemen önce:
 *   kampanya hâlâ RUNNING mi → engel listesi → uyum (SENDABLE olmalı) → günlük sınır.
 * Mesaj önce APPROVED→SCHEDULED olarak "kilitlenir"; süreç çökse bile aynı mesaj ikinci kez gönderilmez.
 */
export async function sendApprovedMessages(
  companyId: string,
  campaignId: string,
  progress?: (pct: number) => Promise<void>,
): Promise<SendRunResult> {
  const db = tenantDb({ companyId });
  const provider = getEmailProvider();
  if (!provider) throw new AppError("VALIDATION", "E-posta sağlayıcısı yapılandırılmamış.");
  const { settings } = await getSenderSettings(companyId);
  if (!settings) throw new AppError("VALIDATION", "Gönderici kimliği eksik.");

  const sentToday = await db.message.count({ where: { direction: "OUTBOUND", sentAt: { gte: startOfToday() } } });
  const quota = Math.max(0, env().EMAIL_DAILY_LIMIT - sentToday);
  const batch = await db.message.findMany({
    where: { campaignId, status: "APPROVED" },
    orderBy: { approvedAt: "asc" },
    take: quota,
  });

  const result: SendRunResult = { sent: 0, failed: 0, skipped: 0, remainingApproved: 0, quotaReached: false, paused: false };
  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i]!;
    const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (campaign?.status !== "RUNNING") {
      result.paused = true;
      break;
    }
    if (!msg.toAddress) {
      await db.message.update({ where: { id: msg.id }, data: { status: "FAILED", error: "Alıcı adresi yok." } });
      result.failed++;
      continue;
    }

    // 1) Engel listesi (ret talebi onaydan sonra gelmiş olabilir)
    const suppression = await findSuppression(companyId, { email: msg.toAddress, leadId: msg.leadId });
    if (suppression) {
      await db.message.update({ where: { id: msg.id }, data: { status: "CANCELLED", error: "Alıcı ret/engel listesinde." } });
      result.skipped++;
      continue;
    }
    // 2) Uyum: yalnızca SENDABLE gönderilir; inceleme gerekenler APPROVED'da bekler
    const { records } = await refreshLeadCompliance(companyId, msg.leadId);
    const rec = records.find((r) => r.address === msg.toAddress);
    if (!rec || rec.status === "DO_NOT_SEND") {
      await db.message.update({ where: { id: msg.id }, data: { status: "CANCELLED", complianceStatus: "DO_NOT_SEND", error: rec?.reasons[0] ?? "Adres artık gönderilemez." } });
      result.skipped++;
      continue;
    }
    if (rec.status !== "SENDABLE") {
      await db.message.update({ where: { id: msg.id }, data: { complianceStatus: rec.status, error: rec.reasons[0] ?? "İnceleme gerekli." } });
      result.skipped++;
      continue;
    }

    // 3) Kilit: yalnızca hâlâ APPROVED ise gönder (eşzamanlı iki iş aynı mesajı gönderemez)
    const claimed = await db.message.updateMany({ where: { id: msg.id, status: "APPROVED" }, data: { status: "SCHEDULED", scheduledAt: new Date() } });
    if (claimed.count === 0) continue;

    const email: OutgoingEmail = {
      from: { email: settings.fromEmail, name: settings.fromName },
      to: msg.toAddress,
      replyTo: settings.replyTo ?? undefined,
      subject: msg.subject ?? "",
      ...buildEmailContent(msg.body, settings, unsubscribeUrl(companyId, msg.id)),
      unsubscribeUrl: oneClickUnsubscribeUrl(companyId, msg.id),
      messageId: msg.id,
    };

    try {
      const res = await provider.send(email);
      const now = new Date();
      await db.message.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: now, provider: provider.name, providerMessageId: res.providerMessageId || null, complianceStatus: "SENDABLE", error: null },
      });
      await db.complianceRecord.update({ where: { id: rec.id }, data: { lastContactedAt: now } });
      if (msg.contactId) await db.leadContact.updateMany({ where: { id: msg.contactId }, data: { lastContactedAt: now } });
      await db.lead.updateMany({ where: { id: msg.leadId, status: { in: [...CONTACTED_FROM] } }, data: { status: "CONTACTED" } });
      await db.campaignLead.updateMany({ where: { campaignId, leadId: msg.leadId }, data: { status: "CONTACTED" } });
      result.sent++;
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      const message = (err as Error).message.slice(0, 500);
      if (retryable) {
        // Geçici hata: kilidi aç, iş tekrar denensin (gönderilenler SENT olduğu için tekrar gönderilmez)
        await db.message.update({ where: { id: msg.id }, data: { status: "APPROVED", error: message } });
        // Ağ hatası gibi işaretsiz hatalar da geçici sayılır; iş katmanı bu işarete bakar
        (err as { retryable?: boolean }).retryable = true;
        throw err;
      }
      await db.message.update({ where: { id: msg.id }, data: { status: "FAILED", error: message } });
      result.failed++;
    }
    await progress?.(((i + 1) / Math.max(1, batch.length)) * 95);
    if (THROTTLE_MS() > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS()));
  }

  result.remainingApproved = await db.message.count({ where: { campaignId, status: "APPROVED" } });
  result.quotaReached = result.remainingApproved > 0 && !result.paused && batch.length >= quota;

  // Onay bekleyen / onaylı mesaj kalmadıysa kampanya tamamlanır
  const open = await db.message.count({ where: { campaignId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"] } } });
  if (open === 0 && !result.paused) {
    await db.campaign.updateMany({ where: { id: campaignId, status: "RUNNING" }, data: { status: "COMPLETED", completedAt: new Date() } });
  } else if (!result.paused && result.remainingApproved === 0) {
    // Gönderilecek onaylı mesaj kalmadı ama onay bekleyen var → hazır durumuna dön
    await db.campaign.updateMany({ where: { id: campaignId, status: "RUNNING" }, data: { status: "READY" } });
  }

  await audit({
    companyId,
    actorType: "SYSTEM",
    action: "campaign.send_batch",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { ...result },
  });
  return result;
}

/** Gönderim işi kalıcı olarak başarısız olursa kampanya duraklatılır (sessizce RUNNING kalmasın). */
export async function pauseAfterSendFailure(companyId: string, campaignId: string, error: string) {
  await tenantDb({ companyId }).campaign.updateMany({ where: { id: campaignId, status: "RUNNING" }, data: { status: "PAUSED" } });
  await audit({ companyId, actorType: "SYSTEM", action: "campaign.send_failed", entityType: "Campaign", entityId: campaignId, metadata: { error: error.slice(0, 500) } });
}
