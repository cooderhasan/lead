"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/server/tenancy/context";
import { parseForm, safeAction } from "@/server/actions/safe-action";
import { createManualLead, deleteLead, updateLeadStatus } from "@/server/services/leads";
import {
  importLeadsCsv,
  startEmailDiscovery,
  startLeadResearch,
  startLeadScoring,
  startLeadSearch,
} from "@/server/services/lead-intelligence";
import { leadSearchFormSchema, leadStatusSchema, manualLeadSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

export async function searchLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const input = parseForm(leadSearchFormSchema, fd);
    const res = await startLeadSearch(ctx, input.prompt, input.limit);
    revalidatePath("/leads");
    return { ok: true, message: `Arama başladı: ${res.interpretation} (en fazla ${res.reserved} lead)` };
  });
}

export async function importLeadsCsvAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Bir CSV dosyası seçin.", { file: "Dosya seçin" });
    const res = await importLeadsCsv(ctx, await file.text());
    revalidatePath("/leads");
    const parts = [`${res.created} yeni lead eklendi`, `${res.merged} mevcut kayıtla birleştirildi`];
    if (res.skipped > 0) parts.push(`${res.skipped} satır atlandı`);
    if (res.unknownHeaders.length > 0) parts.push(`tanınmayan sütunlar: ${res.unknownHeaders.slice(0, 5).join(", ")}`);
    return { ok: true, message: `${parts.join(" · ")}.` };
  });
}

export async function createLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let leadId = "";
  const result = await safeAction(async () => {
    const ctx = await requireTenant();
    const input = parseForm(manualLeadSchema, fd);
    const res = await createManualLead(ctx, {
      companyName: input.companyName,
      website: input.website ?? undefined,
      phone: input.phone ?? undefined,
      genericEmail: input.genericEmail ?? undefined,
      city: input.city ?? undefined,
      district: input.district ?? undefined,
      address: input.address ?? undefined,
      category: input.category ?? undefined,
      sourceType: "MANUAL",
    });
    leadId = res.leadId;
    revalidatePath("/leads");
  });
  if (result.ok && leadId) redirect(`/leads/${leadId}`);
  return result;
}

export async function researchLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const id = String(fd.get("id") ?? "");
    const res = await startLeadResearch(ctx, id);
    revalidatePath(`/leads/${id}`);
    return { ok: true, message: res.alreadyRunning ? "Analiz zaten sürüyor." : "Analiz başladı." };
  });
}

export async function scoreLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const ids = fd.getAll("leadId").filter((v): v is string => typeof v === "string" && v.length > 0);
    const res = await startLeadScoring(ctx, ids);
    revalidatePath("/leads");
    for (const id of ids.slice(0, 1)) revalidatePath(`/leads/${id}`);
    return { ok: true, message: `${res.count} lead puanlanıyor (${res.cost} kredi).` };
  });
}

export async function findEmailsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const ctx = await requireTenant();
    const ids = fd.getAll("leadId").filter((v): v is string => typeof v === "string" && v.length > 0);
    const res = await startEmailDiscovery(ctx, ids);
    revalidatePath("/leads");
    return { ok: true, message: `${res.count} firmanın sitesinde e-posta aranıyor; ilerleme ve sonuç listenin üstünde görünecek.` };
  });
}

export async function updateLeadStatusAction(fd: FormData) {
  const ctx = await requireTenant();
  const input = parseForm(leadStatusSchema, fd);
  await updateLeadStatus(ctx, input.id, input.status);
  revalidatePath(`/leads/${input.id}`);
  revalidatePath("/leads");
}

export async function deleteLeadAction(fd: FormData) {
  const ctx = await requireTenant();
  await deleteLead(ctx, String(fd.get("id")));
  revalidatePath("/leads");
  redirect("/leads");
}
