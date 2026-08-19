'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass, linkClass } from '@/components/ui';
import type { DebtorRow } from '@/types/database';

import { createDebtor, updateDebtor, type DebtorFormState } from './actions';
import { useT } from '@/lib/i18n/provider';

function Submit({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.fields.saving : label}
    </Button>
  );
}

function Fields({ debtor }: { debtor?: DebtorRow }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t.fields.companyName}>
        <input name="name" required defaultValue={debtor?.name ?? ''} className={inputClass} />
      </Field>
      <Field label={t.fields.vat}>
        <input name="vat_number" defaultValue={debtor?.vat_number ?? ''} className={inputClass} />
      </Field>
      <Field label={t.fields.email} hint={t.fields.emailHint}>
        <input name="email" type="email" defaultValue={debtor?.email ?? ''} className={inputClass} />
      </Field>
      <Field label={t.fields.mobile} hint={t.fields.mobileHint}>
        <input name="phone" defaultValue={debtor?.phone ?? ''} className={inputClass} />
      </Field>

      <Field label={t.fields.debtorLocale} hint={t.fields.debtorLocaleHint}>
        <select name="locale" defaultValue={debtor?.locale ?? ''} className={inputClass}>
          <option value="">{t.fields.localeAuto}</option>
          <option value="el">{t.fields.localeEl}</option>
          <option value="en">{t.fields.localeEn}</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label={t.fields.notes}>
          <textarea name="notes" rows={2} defaultValue={debtor?.notes ?? ''} className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

function Feedback({ state }: { state: DebtorFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {state.success}
      </p>
    );
  }
  return null;
}

export function CreateDebtorForm() {
  const t = useT();
  const [state, action] = useActionState<DebtorFormState, FormData>(createDebtor, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t.fields.newCustomer}
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink-900">{t.fields.newCustomer}</h2>
      <Fields />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Submit label={t.fields.add} />
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {t.fields.cancel}
        </Button>
      </div>
    </form>
  );
}

export function EditDebtorForm({ debtor }: { debtor: DebtorRow }) {
  const t = useT();
  const [state, action] = useActionState<DebtorFormState, FormData>(updateDebtor, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm ${linkClass}`}
      >
        {t.fields.edit}
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-4 rounded-lg border border-ink-200 bg-ink-50 p-4">
      <input type="hidden" name="id" value={debtor.id} />
      <Fields debtor={debtor} />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Submit label={t.fields.save} />
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {t.fields.close}
        </Button>
      </div>
    </form>
  );
}
