import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { rawDb } from "@/server/db";
import { consumeCredits } from "@/server/usage/credits";
import { ORPHANED_JOB_MESSAGE, recoverOrphanedJobs } from "@/server/jobs/recovery";
import { createTenant, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await rawDb.$disconnect();
});

const balance = async (companyId: string) => (await rawDb.company.findUniqueOrThrow({ where: { id: companyId } })).creditBalance;

describe("yarım kalan işler (sunucu yeniden başlatıldı)", () => {
  it("önceki süreçte kalmış açık iş başarısız olur ve kredisi bir kez iade edilir; yeni işlere dokunulmaz", async () => {
    const a = await createTenant("A");
    const before = await balance(a.companyId);
    const { usageId } = await consumeCredits({ companyId: a.companyId, operation: "lead.discovery", quantity: 2 });
    expect(await balance(a.companyId)).toBe(before - 2);

    const startedAt = new Date(Date.now() - 60_000);
    const orphan = await rawDb.job.create({
      data: {
        type: "lead.find_website",
        companyId: a.companyId,
        status: "RUNNING",
        payload: { leadIds: [], usageId } as Prisma.InputJsonValue,
        createdAt: new Date(Date.now() - 3_600_000),
      },
    });
    const queuedOld = await rawDb.job.create({
      data: { type: "lead.find_email", companyId: a.companyId, status: "QUEUED", payload: { leadIds: [] }, createdAt: new Date(Date.now() - 3_600_000) },
    });
    const fresh = await rawDb.job.create({ data: { type: "lead.find_email", companyId: a.companyId, status: "RUNNING", payload: { leadIds: [] } } });
    const done = await rawDb.job.create({
      data: { type: "lead.find_email", companyId: a.companyId, status: "SUCCEEDED", payload: { leadIds: [] }, createdAt: new Date(Date.now() - 3_600_000) },
    });

    expect(await recoverOrphanedJobs(startedAt)).toBe(2);
    expect(await rawDb.job.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ status: "FAILED", error: ORPHANED_JOB_MESSAGE });
    expect((await rawDb.job.findUniqueOrThrow({ where: { id: queuedOld.id } })).status).toBe("FAILED");
    expect((await rawDb.job.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("RUNNING");
    expect((await rawDb.job.findUniqueOrThrow({ where: { id: done.id } })).status).toBe("SUCCEEDED");
    expect(await balance(a.companyId)).toBe(before);

    // İkinci tur: yapılacak iş yok, iade tekrarlanmaz
    expect(await recoverOrphanedJobs(startedAt)).toBe(0);
    expect(await balance(a.companyId)).toBe(before);
  });
});
