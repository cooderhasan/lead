import "server-only";
import { rawDb } from "@/server/db";
import { grantCredits } from "@/server/usage/credits";
import { audit } from "@/server/audit/audit";
import { AppError } from "@/lib/errors";
import type { UserContext } from "@/server/tenancy/types";
import { assertPlatformAdmin } from "./stats";

export const MAX_ADMIN_GRANT = 1_000_000;

/** Platform yöneticisi bir şirkete kredi yükler; kullanım geçmişine "Kredi yükleme" ve audit log'a yazılır. */
export async function adminGrantCredits(user: UserContext | null, input: { companyId: string; credits: number }) {
  assertPlatformAdmin(user);
  const { companyId, credits } = input;
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_ADMIN_GRANT) {
    throw new AppError("VALIDATION", `Kredi 1 ile ${MAX_ADMIN_GRANT.toLocaleString("tr-TR")} arasında tam sayı olmalı.`, { credits: "Geçersiz miktar" });
  }
  const company = await rawDb.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw new AppError("NOT_FOUND", "Şirket bulunamadı.");
  await grantCredits(company.id, credits, user.userId);
  await audit({ companyId: company.id, userId: user.userId, action: "credit.granted", entityType: "Company", entityId: company.id, metadata: { credits } });
  const { creditBalance } = await rawDb.company.findUniqueOrThrow({ where: { id: company.id }, select: { creditBalance: true } });
  return { name: company.name, creditBalance };
}
