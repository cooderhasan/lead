import "server-only";
import { rawDb } from "@/server/db";
import { env } from "@/server/env";
import type { JobType } from "./types";

export const ORPHANED_JOB_MESSAGE = "Sunucu yeniden başlatıldığı için iş yarıda kaldı. İşlemi tekrar başlatın; harcanan kredi iade edildi.";

/** Bu sürecin başladığı an (yeniden başlatma / deploy) */
export const processStartedAt = () => new Date(Date.now() - process.uptime() * 1000);

/**
 * Inline sürücüde işler web sürecinin belleğinde çalışır: süreç yeniden başlarsa (deploy) önceki süreçte
 * başlamış işler "çalışıyor" olarak takılı kalır ve aynı türden yeni iş başlatılamaz. Bu süreçten ÖNCE
 * oluşturulmuş ve hâlâ açık görünen işler başarısız sayılır, kredisi iade edilir (handler'ın onFailure'ı).
 * BullMQ sürücüsünde işler Redis'te yaşar ve worker'lar devralır → dokunulmaz.
 */
export async function recoverOrphanedJobs(startedAt: Date = processStartedAt()): Promise<number> {
  if (env().QUEUE_DRIVER !== "inline") return 0;
  const orphans = await rawDb.job.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, createdAt: { lt: startedAt } },
    select: { id: true, type: true, payload: true },
    take: 200,
  });
  if (orphans.length === 0) return 0;
  // Dinamik import: handler'lar servisleri, servisler kuyruğu import eder (statik import döngü oluşturur)
  const { handlers } = await import("./handlers");
  let recovered = 0;
  for (const j of orphans) {
    // Koşullu güncelleme: aynı anda başka bir tur aynı işi işaretlediyse iade iki kez yapılmaz
    const res = await rawDb.job.updateMany({
      where: { id: j.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: ORPHANED_JOB_MESSAGE, finishedAt: new Date() },
    });
    if (res.count === 0) continue;
    recovered++;
    const onFailure = handlers[j.type as JobType]?.onFailure as ((p: unknown, e: string) => Promise<void>) | undefined;
    await onFailure?.(j.payload, ORPHANED_JOB_MESSAGE).catch((e: unknown) => console.error("[job] yarım kalan iş iadesi başarısız", j.id, e));
  }
  if (recovered) console.warn(`[job] ${recovered} yarım kalan iş başarısız işaretlendi (sunucu yeniden başlatılmış)`);
  return recovered;
}
