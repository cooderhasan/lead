"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { correctFactAction, correctSummaryAction } from "@/app/actions/facts";
import { ActionForm, SubmitButton } from "./forms";
import { Button, Textarea } from "./ui";

export function FactEditButton({ factId, value }: { factId: string; value: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Düzelt">
        <Pencil className="size-3.5" aria-hidden /> Düzelt
      </Button>
    );
  }
  return (
    <div className="w-full basis-full">
      <ActionForm action={correctFactAction} onSuccess={() => setEditing(false)} className="gap-2">
        {(state) => (
          <>
            <input type="hidden" name="factId" value={factId} />
            <Textarea name="value" defaultValue={value} className="min-h-16" autoFocus aria-label="Düzeltilmiş değer" />
            {state.error && <p className="text-xs text-danger">{state.error}</p>}
            <div className="flex gap-2">
              <SubmitButton size="sm" pendingText="Kaydediliyor…">Kaydet ve onayla</SubmitButton>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Vazgeç</Button>
            </div>
          </>
        )}
      </ActionForm>
    </div>
  );
}

export function SummaryEditor({ summary }: { summary: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
        <Pencil className="size-4" aria-hidden /> Düzelt
      </Button>
    );
  }
  return (
    <div className="w-full">
      <ActionForm action={correctSummaryAction} onSuccess={() => setEditing(false)} className="gap-2">
        {(state) => (
          <>
            <Textarea name="summary" defaultValue={summary} className="min-h-32" autoFocus aria-label="Şirket özeti" />
            {state.error && <p className="text-xs text-danger">{state.error}</p>}
            <div className="flex gap-2">
              <SubmitButton pendingText="Kaydediliyor…">Kaydet ve onayla</SubmitButton>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Vazgeç</Button>
            </div>
          </>
        )}
      </ActionForm>
    </div>
  );
}
