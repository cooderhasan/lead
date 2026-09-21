import "server-only";
import { classifyReply } from "@/server/services/conversations";
import { sendSingleApprovedMessage } from "@/server/services/campaign-send";
import { processDueFollowUps } from "@/server/services/followups";
import { isAppError } from "@/lib/errors";
import { PermanentJobError, type JobHandler } from "../types";

export const classifyReplyJob: JobHandler<"conversation.classify"> = async ({ conversationMessageId }, h) => {
  if (!h.companyId) throw new PermanentJobError("Şirket bağlamı yok.");
  return classifyReply(h.companyId, conversationMessageId);
};

export const sendMessageJob: JobHandler<"message.send"> = async ({ messageId }, h) => {
  if (!h.companyId) throw new PermanentJobError("Şirket bağlamı yok.");
  try {
    return { outcome: await sendSingleApprovedMessage(h.companyId, messageId) };
  } catch (err) {
    // Sağlayıcı geçici hatası tekrar denenir; diğerleri kalıcıdır
    if ((err as { retryable?: boolean }).retryable === true && !h.isFinalAttempt) throw new Error((err as Error).message);
    if (isAppError(err) || (err as { retryable?: boolean }).retryable === true) throw new PermanentJobError((err as Error).message);
    throw err;
  }
};

export const followUpRunJob: JobHandler<"followup.run"> = async (_payload, h) => {
  if (!h.companyId) throw new PermanentJobError("Şirket bağlamı yok.");
  return { ...(await processDueFollowUps(h.companyId)) };
};
