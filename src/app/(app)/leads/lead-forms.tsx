"use client";

import {
  createLeadAction,
  importLeadsCsvAction,
  researchLeadAction,
  scoreLeadsAction,
  searchLeadsAction,
} from "@/app/actions/leads";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Field, Input, Textarea } from "@/components/ui";
import { Search, Sparkles, Upload } from "lucide-react";

export function LeadSearchForm({ enabled, maxLimit }: { enabled: boolean; maxLimit: number }) {
  return (
    <ActionForm action={searchLeadsAction} resetOnSuccess>
      {(state) => (
        <>
          <FormMessage state={state} />
          <Field
            label="Ne tür müşteriler arıyorsunuz?"
            htmlFor="prompt"
            hint={`Her yeni lead 1 kredi. Mevcut kayıtla eşleşenler ücretsiz. En fazla ${maxLimit} lead.`}
            error={state.fieldErrors?.prompt}
          >
            <Textarea
              id="prompt"
              name="prompt"
              rows={2}
              maxLength={1000}
              required
              disabled={!enabled}
              placeholder="ör. Bursa ve Kocaeli'deki otomotiv yan sanayi firmaları, metal pres ve kalıp üreticileri"
            />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Adet" htmlFor="limit" className="w-28">
              <Input id="limit" name="limit" type="number" min={1} max={maxLimit} defaultValue={Math.min(20, maxLimit)} disabled={!enabled} />
            </Field>
            <SubmitButton pendingText="Anlaşılıyor…" className="self-end">
              <Search className="size-4" aria-hidden /> Lead bul
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function CsvImportForm() {
  return (
    <ActionForm action={importLeadsCsvAction} resetOnSuccess>
      {(state) => (
        <>
          <FormMessage state={state} />
          <Field
            label="CSV dosyası"
            htmlFor="file"
            hint="İlk satır başlık: Firma, Web, Telefon, E-posta, İl, İlçe, Sektör… Ayraç ; veya , olabilir. Kredi harcamaz."
            error={state.fieldErrors?.file}
          >
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="block w-full cursor-pointer rounded-lg border border-border bg-surface text-sm text-text-2 file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-border file:bg-surface-2 file:px-3 file:py-2.5 file:text-sm file:font-medium file:text-text"
            />
          </Field>
          <SubmitButton variant="secondary" pendingText="İçe aktarılıyor…" className="self-start">
            <Upload className="size-4" aria-hidden /> İçe aktar
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ManualLeadForm() {
  return (
    <ActionForm action={createLeadAction}>
      {(state) => (
        <>
          <FormMessage state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Firma adı" htmlFor="companyName" error={state.fieldErrors?.companyName}>
              <Input id="companyName" name="companyName" required maxLength={300} />
            </Field>
            <Field label="Web sitesi" htmlFor="website" error={state.fieldErrors?.website}>
              <Input id="website" name="website" placeholder="ornek.com.tr" />
            </Field>
            <Field label="Telefon (kurumsal)" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" />
            </Field>
            <Field label="E-posta (kurumsal, info@…)" htmlFor="genericEmail" error={state.fieldErrors?.genericEmail}>
              <Input id="genericEmail" name="genericEmail" type="email" />
            </Field>
            <Field label="İl" htmlFor="city">
              <Input id="city" name="city" />
            </Field>
            <Field label="İlçe / OSB" htmlFor="district">
              <Input id="district" name="district" />
            </Field>
            <Field label="Sektör" htmlFor="category" className="sm:col-span-2">
              <Input id="category" name="category" />
            </Field>
          </div>
          <SubmitButton pendingText="Kaydediliyor…" className="self-start">Kaydet</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ResearchLeadButton({ leadId, hasWebsite }: { leadId: string; hasWebsite: boolean }) {
  return (
    <ActionForm action={researchLeadAction} className="gap-2">
      {(state) => (
        <>
          <input type="hidden" name="id" value={leadId} />
          <SubmitButton pendingText="Başlatılıyor…" size="sm">
            <Sparkles className="size-4" aria-hidden /> {hasWebsite ? "AI ile Analiz Et (2 kredi)" : "AI ile Analiz Et"}
          </SubmitButton>
          <FormMessage state={state} />
        </>
      )}
    </ActionForm>
  );
}

export function ScoreLeadsButton({ leadIds, label }: { leadIds: string[]; label: string }) {
  return (
    <ActionForm action={scoreLeadsAction} className="gap-2">
      {(state) => (
        <>
          {leadIds.map((id) => (
            <input key={id} type="hidden" name="leadId" value={id} />
          ))}
          <SubmitButton variant="secondary" size="sm" pendingText="Başlatılıyor…">
            {label}
          </SubmitButton>
          <FormMessage state={state} />
        </>
      )}
    </ActionForm>
  );
}
