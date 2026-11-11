"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/session";
import { safeAction } from "@/server/actions/safe-action";
import { adminGrantCredits } from "@/server/admin/credits";
import type { ActionState } from "@/lib/action-state";

export async function grantCreditsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await getCurrentUser();
    const res = await adminGrantCredits(user, { companyId: String(fd.get("companyId") ?? ""), credits: Number(fd.get("credits")) });
    revalidatePath("/admin");
    return { ok: true, message: `${res.name}: yeni bakiye ${res.creditBalance.toLocaleString("tr-TR")} kredi.` };
  });
}
