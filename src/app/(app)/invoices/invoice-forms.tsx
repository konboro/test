'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import { payPath } from '@/lib/pay-code';

import { createInvoice, type InvoiceFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Καταχώρηση…' : 'Καταχώρηση'}
    </Button>
  );
}

export function CreateInvoiceForm({
  debtors,
}: {
  debtors: Array<{ id: string; name: string }>;
}) {
  const [state, action] = useActionState<InvoiceFormState, FormData>(createInvoice, {});
  const [open, setOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={debtors.length === 0}>
        Χειροκίνητο παραστατικό
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink-900">Νέο παραστατικό</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Πελάτης">
          <select name="debtor_id" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Επιλέξτε…
            </option>
            {debtors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Ποσό (€)">
          <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
        </Field>

        <Field label="Σειρά">
          <input name="series" className={inputClass} />
        </Field>

        <Field label="Αριθμός">
          <input name="invoice_number" required className={inputClass} />
        </Field>

        <Field label="Ημ. έκδοσης">
          <input name="issue_date" type="date" required defaultValue={today} className={inputClass} />
        </Field>

        <Field label="Ημ. λήξης">
          <input name="due_date" type="date" required className={inputClass} />
        </Field>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Submit />
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Άκυρο
        </Button>
      </div>
    </form>
  );
}

/** Copies the debtor-facing payment URL to the clipboard. */
export function CopyPayLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${payPath(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; fall back to a prompt the user can copy from.
      window.prompt('Αντιγράψτε τον σύνδεσμο πληρωμής:', url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="text-sm font-medium text-brand-600 hover:underline"
    >
      {copied ? 'Αντιγράφηκε' : 'Σύνδεσμος πληρωμής'}
    </button>
  );
}
