'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Modal } from '@/components/modal';
import { Button, Field, inputClass, linkClass, subtleLinkClass } from '@/components/ui';
import type { ReminderPreview } from '@/lib/dunning/manual';
import { REMINDER_CHOICES } from '@/lib/dunning/templates';

import {
  createInvoice,
  previewReminder,
  sendReminder,
  type InvoiceFormState,
  type ReminderState,
} from './actions';

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

/**
 * Sends a reminder for this invoice, after choosing the wording and reading
 * exactly what will go out.
 *
 * The preview is rendered by the same code that does the sending, on the server,
 * with this invoice's real values substituted — a preview assembled separately
 * in the browser would eventually disagree with the message, which defeats the
 * point of having one.
 */
export function RemindButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('manual');
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, action, sending] = useActionState<ReminderState, FormData>(sendReminder, {});

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    previewReminder(invoiceId, choice)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // A stale response from the previously selected wording must not overwrite
    // the current one.
    return () => {
      cancelled = true;
    };
  }, [open, choice, invoiceId]);

  const sent = Boolean(state.success);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm ${linkClass}`}
        title="Προεπισκόπηση και αποστολή υπενθύμισης"
      >
        Υπενθύμιση
      </button>

      {open ? (
        <Modal
          title="Υπενθύμιση πληρωμής"
          subtitle={`Παραστατικό ${label}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {sent ? 'Κλείσιμο' : 'Άκυρο'}
              </Button>

              {!sent ? (
                <form action={action}>
                  <input type="hidden" name="id" value={invoiceId} />
                  <input type="hidden" name="choice" value={choice} />
                  <Button type="submit" disabled={sending || loading || !preview?.willSend?.length}>
                    {sending ? 'Αποστολή…' : 'Αποστολή τώρα'}
                  </Button>
                </form>
              ) : null}
            </>
          }
        >
          <Field label="Κείμενο">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={sent}
              className={inputClass}
            >
              {REMINDER_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <p className="text-xs text-ink-500">
            Επιλέγετε μόνο το κείμενο. Η χειροκίνητη αποστολή δεν καταναλώνει βήμα της
            αυτόματης ροής — το βήμα 2 θα σταλεί κανονικά αργότερα.
          </p>

          {loading ? (
            <p className="text-sm text-ink-500">Φόρτωση προεπισκόπησης…</p>
          ) : preview?.ok ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {preview.willSend?.length ? (
                  preview.willSend.map((channel) => (
                    <span
                      key={channel}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
                    >
                      {channel === 'email' ? `Email → ${preview.emailTo}` : `SMS → ${preview.smsTo}`}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                    Κανένα διαθέσιμο κανάλι
                  </span>
                )}
              </div>

              {preview.notes?.length ? (
                <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {preview.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}

              {preview.willSend?.includes('email') ? (
                <div className="rounded-lg border border-ink-200">
                  <div className="border-b border-ink-100 px-3 py-2 text-xs text-ink-500">
                    Θέμα: <span className="text-ink-800">{preview.subject}</span>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-ink-800">
                    {preview.emailBody}
                  </pre>
                </div>
              ) : null}

              {preview.willSend?.includes('sms') ? (
                <div className="rounded-lg border border-ink-200">
                  <div className="border-b border-ink-100 px-3 py-2 text-xs text-ink-500">
                    SMS — {preview.smsSegments} τμήμα(τα)
                  </div>
                  <pre className="whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-ink-800">
                    {preview.smsBody}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {preview?.error ?? 'Δεν ήταν δυνατή η προεπισκόπηση.'}
            </p>
          )}

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
        </Modal>
      ) : null}
    </>
  );
}

/** Copies the debtor-facing payment URL to the clipboard. */
export function CopyPayLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/pay/${token}`;
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
    <button type="button" onClick={copy} className={`text-sm ${subtleLinkClass}`}>
      {copied ? 'Αντιγράφηκε' : 'Σύνδεσμος πληρωμής'}
    </button>
  );
}
