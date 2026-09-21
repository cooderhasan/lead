import "server-only";
import { rawDb } from "@/server/db";

/**
 * Sağlayıcı webhook'u yalnızca sağlayıcının mesaj kimliğini bilir; hangi şirkete ait olduğunu
 * bulmak için tek, salt okunur çapraz-tenant sorgu. Sonraki tüm işlemler tenantDb ile yapılır.
 */
export async function findMessageOwner(providerMessageId: string) {
  if (!providerMessageId) return null;
  return rawDb.message.findFirst({
    where: { providerMessageId },
    select: { id: true, companyId: true },
  });
}
