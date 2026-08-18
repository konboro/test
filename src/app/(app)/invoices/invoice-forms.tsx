'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Modal } from '@/components/modal';
import { Button, Field, inputClass, linkClass, subtleLinkClass } from '@/components/ui';
import type { ReminderPreview } from '@/lib/dunning/manual';
import { REMINDER_CHOICES } from '@/lib/dunning/templates';
import { useT } from '@/lib/i18n/provider';
import { payPath } from '@/lib/pay-code';

import {
  createInvoice,
  previewReminder,
  sendReminder,
  updateDueDate,
  type InvoiceFormState,
  type ReminderState,
} from './actions';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : t.common.save}
    </Button>
  );
}

export function CreateInvoiceForm({
  debtors,
}: {
  debtors: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [state, action] = useActionState<InvoiceFormState, FormData>(createInvoice, {});
  const [open, setOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={debtors.length === 0}>
        {t.invoices.newManual}
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink-900">{t.invoiceForm.heading}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.invoiceForm.customer}>
          <select name="debtor_id" required className={inputClass} defaultValue="">
            <option value="" disabled>
              {t.invoiceForm.choose}
            </option>
            {debtors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t.invoiceForm.amount}>
          <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
        </Field>

        <Field label={t.invoiceForm.series}>
          <input name="series" className={inputClass} />
        </Field>

        <Field label={t.invoiceForm.number}>
          <input name="invoice_number" required className={inputClass} />
        </Field>

        <Field label={t.invoiceForm.issueDate}>
          <input name="issue_date" type="date" required defaultValue={today} className={inputClass} />
        </Field>

        <Field label={t.invoiceForm.dueDate}>
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
          {t.common.cancel}
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
  const t = useT();
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
        title={t.invoices.remindHint}
      >
        {t.invoices.remind}
      </button>

      {open ? (
        <Modal
          title={t.reminder.title}
          subtitle={t.reminder.invoiceLabel(label)}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {sent ? t.common.close : t.common.cancel}
              </Button>

              {!sent ? (
                <form action={action}>
                  <input type="hidden" name="id" value={invoiceId} />
                  <input type="hidden" name="choice" value={choice} />
                  <Button type="submit" disabled={sending || loading || !preview?.willSend?.length}>
                    {sending ? t.reminder.sending : t.reminder.send}
                  </Button>
                </form>
              ) : null}
            </>
          }
        >
          <Field label={t.reminder.templateLabel}>
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
            {t.reminder.note}
          </p>

          {loading ? (
            <p className="text-sm text-ink-500">{t.reminder.loading}</p>
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
                    {t.reminder.noChannel}
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
                    {t.reminder.subjectLabel}: <span className="text-ink-800">{preview.subject}</span>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-ink-800">
                    {preview.emailBody}
                  </pre>
                </div>
              ) : null}

              {preview.willSend?.includes('sms') ? (
                <div className="rounded-lg border border-ink-200">
                  <div className="border-b border-ink-100 px-3 py-2 text-xs text-ink-500">
                    {t.reminder.smsSegments(preview.smsSegments ?? 0)}
                  </div>
                  <pre className="whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-ink-800">
                    {preview.smsBody}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {preview?.error ?? t.reminder.previewFailed}
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

/**
 * Edits one invoice's due date.
 *
 * The date itself is the control: it is already in the row, and making it
 * clickable avoids adding another action to a table that has three of them.
 */
export function DueDateButton({
  invoiceId,
  dueDate,
  display,
}: {
  invoiceId: string;
  dueDate: string;
  display: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Mirrored into a hidden field so the value survives the form submit — a bare
  // date input inside the modal is not part of the footer form.
  const [chosen, setChosen] = useState(dueDate);
  const [state, action, saving] = useActionState<ReminderState, FormData>(updateDueDate, {});

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.invoices.editDueDate}
        className="tabular underline-offset-2 transition hover:text-brand-600 hover:underline"
      >
        {display}
      </button>

      {open ? (
        <Modal
          title={t.invoices.editDueDate}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <form action={action}>
                <input type="hidden" name="id" value={invoiceId} />
                <input type="hidden" name="due_date" value={chosen} />
                <Button type="submit" disabled={saving}>
                  {saving ? t.common.saving : t.common.save}
                </Button>
              </form>
            </>
          }
        >
          <Field label={t.invoices.dueDateLabel}>
            <input
              type="date"
              defaultValue={dueDate}
              onChange={(e) => setChosen(e.target.value)}
              className={inputClass}
            />
          </Field>

          {state.error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error === 'invalid' ? t.invoices.dueDateInvalid : state.error}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

/** Copies the debtor-facing payment URL to the clipboard. */
export function CopyPayLink({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${payPath(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; fall back to a prompt the user can copy from.
      window.prompt(t.common.copyLinkPrompt, url);
    }
  }

  return (
    <button type="button" onClick={copy} className={`text-sm ${subtleLinkClass}`}>
      {copied ? t.invoices.payLinkCopied : t.invoices.payLink}
    </button>
  );
}
