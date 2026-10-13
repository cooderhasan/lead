import "server-only";
import { tenantDb } from "@/server/tenancy/tenant-db";

export type MessageLanguage = "tr" | "en";

/**
 * İletinin dili (alt bilgi ve ret sayfası bu dilde gösterilir).
 * Kampanya iletisi → kampanyanın dili; yanıt taslağı → aynı konuşmadaki kampanya iletisinin dili.
 * Bilinmiyorsa Türkçe.
 */
export async function resolveMessageLanguage(
  companyId: string,
  msg: { campaignId: string | null; conversationId: string | null },
): Promise<MessageLanguage> {
  const db = tenantDb({ companyId });
  let campaignId = msg.campaignId;
  if (!campaignId && msg.conversationId) {
    const first = await db.message.findFirst({
      where: { conversationId: msg.conversationId, campaignId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { campaignId: true },
    });
    campaignId = first?.campaignId ?? null;
  }
  if (!campaignId) return "tr";
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { language: true } });
  return campaign?.language === "en" ? "en" : "tr";
}
