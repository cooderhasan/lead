"use client";

import {
  createLeadAction,
  importLeadsCsvAction,
  researchLeadAction,
  scoreLeadsAction,
  searchLeadsAction,
} from "@/app/actions/leads";
import { reviewComplianceAction } from "@/app/actions/email";
import { addReplyAction } from "@/app/actions/conversations";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
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

export function ManualReplyForm({ leadId, defaultFrom }: { leadId: string; defaultFrom: string }) {
  return (
    <ActionForm action={addReplyAction} resetOnSuccess>
      {(state) => (
        <>
          <FormMessage state={state} />
          <input type="hidden" name="leadId" value={leadId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Yanıtı gönderen" htmlFor="fromAddress" error={state.fieldErrors?.fromAddress}>
              <Input id="fromAddress" name="fromAddress" type="email" defaultValue={defaultFrom} required />
            </Field>
            <Field label="Konu" htmlFor="replySubject">
              <Input id="replySubject" name="subject" maxLength={300} />
            </Field>
          </div>
          <Field label="Yanıt metni" htmlFor="replyBody" error={state.fieldErrors?.body} hint="AI sınıflandırır; ret ifadesi varsa adres hemen engel listesine eklenir.">
            <Textarea id="replyBody" name="body" rows={5} required maxLength={50_000} />
          </Field>
          <SubmitButton size="sm" pendingText="Ekleniyor…" className="self-start">Yanıtı ekle</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ComplianceReviewForm({ recordId, leadId }: { recordId: string; leadId: string }) {
  return (
    <ActionForm action={reviewComplianceAction} className="gap-2">
      {(state) => (
        <>
          <input type="hidden" name="id" value={recordId} />
          <input type="hidden" name="leadId" value={leadId} />
          <div className="flex flex-wrap items-center gap-2">
            <Select name="basis" defaultValue="" aria-label="İletişim dayanağı" className="h-8 w-60 text-xs" required>
              <option value="" disabled>İletişim dayanağı seçin…</option>
              <option value="B2B_TRADER_ADDRESS">Tacir kurumsal adresi</option>
              <option value="EXISTING_RELATIONSHIP">Mevcut müşteri ilişkisi</option>
              <option value="INBOUND_REQUEST">Firmadan gelen talep</option>
              <option value="EXPLICIT_CONSENT">Açık onay alındı</option>
            </Select>
            <SubmitButton size="sm" variant="secondary" pendingText="Kaydediliyor…">İnceledim, kaydet</SubmitButton>
          </div>
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
