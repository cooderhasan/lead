import "server-only";
import { importFromList } from "@/server/services/lead-intelligence";
import { FetchBlockedError } from "@/server/web/fetch-site";
import { refundCredits } from "@/server/usage/credits";
import { audit } from "@/server/audit/audit";
import { isAppError } from "@/lib/errors";
import { PermanentJobError, type JobHandler, type JobPayloads } from "../types";

export const listImportJob: JobHandler<"lead.list_import"> = async (payload, h) => {
  if (!h.companyId) throw new PermanentJobError("Şirket bağlamı yok.");
  let res: Awaited<ReturnType<typeof importFromList>>;
  try {
    res = await importFromList(h.companyId, payload, h.progress);
  } catch (err) {
    // Sayfa yasak / açılmıyor / okunamıyor → tekrar denemenin anlamı yok
    if (err instanceof FetchBlockedError || (isAppError(err) && err.code === "VALIDATION")) throw new PermanentJobError((err as Error).message);
    if (!isAppError(err) && payload.url) throw new PermanentJobError((err as Error).message);
    throw err;
  }
  // Hiç firma çıkmadıysa kredi iade edilir (kullanıcı değer almadı)
  if (res.created + res.merged === 0 && payload.usageId) await refundCredits(payload.usageId, "lead.list_import.empty");
  await audit({
    companyId: h.companyId,
    userId: h.createdById,
    actorType: "AI",
    action: "lead.list_import.completed",
    metadata: { extracted: res.extracted, dropped: res.dropped, created: res.created, merged: res.merged },
  });
  return res;
};

export async function onListImportFailure(payload: JobPayloads["lead.list_import"]) {
  if (payload.usageId) await refundCredits(payload.usageId, "lead.list_import.failed");
}
