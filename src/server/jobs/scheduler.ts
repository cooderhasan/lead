import "server-only";
import { rawDb } from "@/server/db";
import { enqueue } from "./queue";

/** Aynı şirket için hatırlatma işi en fazla bu sıklıkta kuyruğa girer (kredi / AI yoksa boşa dönmesin). */
const MIN_INTERVAL_MS = 30 * 60_000;

/**
 * Zamanlayıcı turu: vakti gelmiş hatırlatması olan şirketler için "followup.run" işi kuyruğa alınır.
 * Şirketler arası tek sorgu (yalnızca companyId okunur); işlemin kendisi tenantDb ile şirket içinde yapılır.
 */
export async function runSchedulerTick(now = new Date()) {
  const due = await rawDb.followUp.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, campaign: { status: { notIn: ["PAUSED", "ARCHIVED"] } } },
    distinct: ["companyId"],
    select: { companyId: true },
  });
  let enqueued = 0;
  for (const { companyId } of due) {
    const recent = await rawDb.job.findFirst({
      where: {
        companyId,
        type: "followup.run",
        // Sıklık sınırı gerçek saate göre (now yalnızca "vakti geldi mi" karşılaştırması içindir)
        OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { createdAt: { gte: new Date(Date.now() - MIN_INTERVAL_MS) } }],
      },
      select: { id: true },
    });
    if (recent) continue;
    await enqueue("followup.run", {}, { companyId, maxAttempts: 2 });
    enqueued++;
  }
  return { companies: due.length, enqueued };
}
