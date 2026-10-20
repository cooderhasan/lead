"use client";

import { saveInquiryMailboxAction, startInquiryAnalysisAction } from "@/app/actions/inquiries";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";

export interface MailboxFormValues {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  mailbox?: string;
}

export function InquiryMailboxForm({ values, hasPassword }: { values: MailboxFormValues; hasPassword: boolean }) {
  return (
    <ActionForm action={saveInquiryMailboxAction}>
      {(state) => (
        <>
          <FormMessage state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IMAP sunucusu" htmlFor="host" error={state.fieldErrors?.host} hint="Barındırma panelindeki gelen posta sunucusu, ör. mail.firma.com.tr">
              <Input id="host" name="host" defaultValue={values.host} required maxLength={200} placeholder="mail.firma.com.tr" />
            </Field>
            <Field label="Port" htmlFor="port" error={state.fieldErrors?.port} hint="SSL ile genelde 993">
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={values.port ?? 993} required />
            </Field>
            <Field label="Kullanıcı adı" htmlFor="user" error={state.fieldErrors?.user} hint="Genelde e-posta adresinin kendisi">
              <Input id="user" name="user" defaultValue={values.user} required maxLength={200} autoComplete="off" />
            </Field>
            <Field
              label="Şifre"
              htmlFor="pass"
              error={state.fieldErrors?.pass}
              hint={hasPassword ? "Kayıtlı şifre korunur; değiştirmek için yenisini yazın." : "Şifrelenmiş olarak saklanır."}
            >
              <Input id="pass" name="pass" type="password" maxLength={200} autoComplete="new-password" required={!hasPassword} />
            </Field>
            <Field label="Klasör" htmlFor="mailbox" error={state.fieldErrors?.mailbox}>
              <Input id="mailbox" name="mailbox" defaultValue={values.mailbox ?? "INBOX"} maxLength={120} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-text">
              <input type="checkbox" name="secure" defaultChecked={values.secure ?? true} className="accent-[var(--accent)]" />
              SSL/TLS kullan
            </label>
          </div>
          <SubmitButton pendingText="Bağlantı deneniyor…" className="self-start">
            Bağlantıyı dene ve kaydet
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function StartAnalysisButton() {
  return (
    <ActionForm action={startInquiryAnalysisAction} className="gap-2">
      {(state) => (
        <>
          <SubmitButton pendingText="Başlatılıyor…" className="self-start">
            Teklif taleplerini analiz et
          </SubmitButton>
          <FormMessage state={state} />
        </>
      )}
    </ActionForm>
  );
}
