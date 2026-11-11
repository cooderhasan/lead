"use client";

import { grantCreditsAction } from "@/app/actions/admin";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";

/** Şirket satırında kredi yükleme: miktar + düğme */
export function CreditGrantForm({ companyId, companyName }: { companyId: string; companyName: string }) {
  return (
    <ActionForm action={grantCreditsAction} resetOnSuccess className="gap-1.5">
      {(state) => (
        <>
          <input type="hidden" name="companyId" value={companyId} />
          <div className="flex items-center gap-2">
            <label htmlFor={`credits-${companyId}`} className="sr-only">{companyName} için yüklenecek kredi</label>
            <Input id={`credits-${companyId}`} name="credits" type="number" min={1} max={1_000_000} step={1} defaultValue={1000} required className="h-8 w-28 text-right tabular-nums" />
            <SubmitButton size="sm" variant="secondary" pendingText="Yükleniyor…">Kredi yükle</SubmitButton>
          </div>
          <FormMessage state={state} />
        </>
      )}
    </ActionForm>
  );
}
