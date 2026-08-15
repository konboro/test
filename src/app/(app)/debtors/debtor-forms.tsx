'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import type { DebtorRow } from '@/types/database';

import { createDebtor, updateDebtor, type DebtorFormState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Αποθήκευση…' : label}
    </Button>
  );
}

function Fields({ debtor }: { debtor?: DebtorRow }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Επωνυμία">
        <input name="name" required defaultValue={debtor?.name ?? ''} className={inputClass} />
      </Field>
      <Field label="ΑΦΜ">
        <input name="vat_number" defaultValue={debtor?.vat_number ?? ''} className={inputClass} />
      </Field>
      <Field label="Email" hint="Απαραίτητο για τις υπενθυμίσεις email.">
        <input name="email" type="email" defaultValue={debtor?.email ?? ''} className={inputClass} />
      </Field>
      <Field label="Κινητό" hint="Μορφή +30 69XXXXXXXX. Απαραίτητο για SMS.">
        <input name="phone" defaultValue={debtor?.phone ?? ''} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Σημειώσεις">
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
  const [state, action] = useActionState<DebtorFormState, FormData>(createDebtor, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Νέος πελάτης
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink-900">Νέος πελάτης</h2>
      <Fields />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Submit label="Προσθήκη" />
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Άκυρο
        </Button>
      </div>
    </form>
  );
}

export function EditDebtorForm({ debtor }: { debtor: DebtorRow }) {
  const [state, action] = useActionState<DebtorFormState, FormData>(updateDebtor, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        Επεξεργασία
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-4 rounded-lg border border-ink-200 bg-ink-50 p-4">
      <input type="hidden" name="id" value={debtor.id} />
      <Fields debtor={debtor} />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Submit label="Αποθήκευση" />
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Κλείσιμο
        </Button>
      </div>
    </form>
  );
}
