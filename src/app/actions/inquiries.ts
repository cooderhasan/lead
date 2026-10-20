"use server";

import { revalidatePath } from "next/cache";
import type { FactStatus } from "@prisma/client";
import { requireTenant } from "@/server/tenancy/context";
import { parseForm, safeAction } from "@/server/actions/safe-action";
import { deleteInquiryMailbox, saveInquiryMailbox, setInquiryStatus, startInquiryAnalysis } from "@/server/services/inquiry-insights";
import { inquiryMailboxSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

const STATUSES: FactStatus[] = ["PENDING", "VERIFIED", "REJECTED"];

export async function saveInquiryMailboxAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const res = await saveInquiryMailbox(ctx, parseForm(inquiryMailboxSchema, fd));
    revalidatePath("/inquiries");
    return { ok: true, message: `Bağlantı başarılı (klasörde ${res.messages} ileti var). Ayarlar kaydedildi.` };
  });
}

export async function deleteInquiryMailboxAction(fd: FormData) {
  void fd;
  const ctx = await requireTenant();
  await deleteInquiryMailbox(ctx);
  revalidatePath("/inquiries");
}

export async function startInquiryAnalysisAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    await startInquiryAnalysis(ctx, { full: fd.get("full") === "1" });
    revalidatePath("/inquiries");
    return { ok: true, message: "Analiz başladı." };
  });
}

export async function setInquiryStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const status = String(fd.get("status")) as FactStatus;
    if (!STATUSES.includes(status)) throw new AppError("VALIDATION", "Geçersiz durum.");
    await setInquiryStatus(ctx, String(fd.get("id") ?? ""), status);
    revalidatePath("/inquiries");
    return { ok: true };
  });
}
