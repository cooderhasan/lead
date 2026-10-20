import "server-only";
import { runInquiryAnalysis } from "@/server/services/inquiry-insights";
import { audit } from "@/server/audit/audit";
import { isAppError } from "@/lib/errors";
import { PermanentJobError, type JobHandler } from "../types";

export const inquiryAnalyzeJob: JobHandler<"inquiry.analyze"> = async (payload, h) => {
  if (!h.companyId) throw new PermanentJobError("Şirket bağlamı yok.");
  let res: Awaited<ReturnType<typeof runInquiryAnalysis>>;
  try {
    res = await runInquiryAnalysis(h.companyId, h.progress, { full: payload.full });
  } catch (err) {
    // Bağlantı / şifre hatası: tekrar denemenin anlamı yok
    if (isAppError(err) && err.code === "VALIDATION") throw new PermanentJobError(err.message);
    throw err;
  }
  await audit({ companyId: h.companyId, userId: h.createdById, actorType: "AI", action: "inquiry.analysis.completed", metadata: { ...res } });
  return res;
};
