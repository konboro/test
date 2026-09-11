'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Modal } from '@/components/modal';
import { Button, Field, inputClass, linkClass, subtleLinkClass } from '@/components/ui';
import type { ReminderPreview } from '@/lib/dunning/manual';
import { REMINDER_CHOICES } from '@/lib/dunning/templates';
import { Switch } from '@/components/switch';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { useT } from '@/lib/i18n/provider';
import { payPath } from '@/lib/pay-code';

import type { Scenario } from '@/lib/dunning/scenario';

import {
  createInvoice,
  previewReminder,
  sendReminder,
  toggleInvoiceAutomation,
  updateDueDate,
  type InvoiceFormState,
  type ReminderState,
} from './actions';
import { InvoiceScenarioEditor } from './scenario-editor';

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
  scenario,
  notice,
}: {
  debtors: Array<{ id: string; name: string }>;
  /**
   * The account cadence, so the choice can be made here rather than remembered
   * and applied afterwards. Raising an invoice for a customer who has agreed
   * different terms is the moment a person knows that — not a screen later.
   */
  scenario: Scenario;
  /** The notice wording, for the quick editor — see InvoiceScenarioEditor. */
  notice?: { emailSubject: string; emailBody: string; smsBody: string };
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

        {/* Beside the amount, because the two are one fact. The label used to
            read "Amount (€)" and the row was written as euros whatever the
            document said — fine until the first zloty invoice, which would have
            been stored as euros and charged as euros. */}
        <Field label={t.invoiceForm.currency}>
          <select name="currency" defaultValue={DEFAULT_CURRENCY} className={inputClass}>
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
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

      <div className="border-t border-ink-100 pt-4">
        {/* The editor's switch row carries its own title; a caption above it
            would say the same words twice in two type styles. */}
        <InvoiceScenarioEditor scenario={scenario} notice={notice} />
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
  const [only, setOnly] = useState('both');
  const [lang, setLang] = useState('auto');
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, action, sending] = useActionState<ReminderState, FormData>(sendReminder, {});

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    previewReminder(invoiceId, choice, only, lang)
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
  }, [open, choice, only, lang, invoiceId]);

  const sent = Boolean(state.success);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-11 items-center sm:min-h-0 text-sm ${linkClass}`}
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
              {/* Beside the buttons, not at the end of the body. The preview runs
                  to two message bodies, so a confirmation placed after it lands
                  below the fold of a scrolling panel — and a send that reports
                  success out of sight is indistinguishable from one that did
                  nothing. */}
              {state.error ? (
                <p
                  role="alert"
                  className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {state.error}
                </p>
              ) : null}
              {state.success ? (
                <p
                  role="status"
                  className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                >
                  {state.success}
                </p>
              ) : null}

              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {sent ? t.common.close : t.common.cancel}
              </Button>

              {!sent ? (
                <form action={action}>
                  <input type="hidden" name="id" value={invoiceId} />
                  <input type="hidden" name="choice" value={choice} />
                  <input type="hidden" name="only" value={only} />
                  <input type="hidden" name="lang" value={lang} />
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
                  {t.reminder.choices[c.value] ?? c.value}
                </option>
              ))}
            </select>
          </Field>

          {/* Narrows the send to one channel. The preview below re-renders for
              the choice, so what is on screen is always what will go out. */}
          <Field label={t.reminder.channelLabel}>
            <select
              value={only}
              onChange={(e) => setOnly(e.target.value)}
              disabled={sent}
              className={inputClass}
            >
              <option value="both">{t.reminder.channelBoth}</option>
              <option value="email">{t.reminder.channelEmail}</option>
              <option value="sms">{t.reminder.channelSms}</option>
            </select>
          </Field>

          {/* The language the customer is written to in. "Automatic" is what the
              customer's own setting and phone country code work out to; the
              label names the result, because an operator about to send should
              not have to trust that the automatic choice is the right one. */}
          <Field label={t.reminder.languageLabel} hint={lang === 'auto' ? t.reminder.languageFrom : undefined}>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={sent}
              className={inputClass}
            >
              <option value="auto">
                {preview?.locale
                  ? t.reminder.languageAuto(
                      preview.locale === 'el' ? t.fields.localeEl : t.fields.localeEn,
                    )
                  : t.fields.localeAuto}
              </option>
              <option value="el">{t.fields.localeEl}</option>
              <option value="en">{t.fields.localeEn}</option>
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

        </Modal>
      ) : null}
    </>
  );
}

/**
 * Whether the automatic scenario runs for this invoice.
 *
 * The same switch as the customer and tenant ones, at the smallest size. It was
 * a checkbox, which read as "tick to select" in a table whose other checkbox
 * does exactly that — two identical boxes in one row, one selecting for a bulk
 * send and one deciding whether an invoice is chased at all.
 *
 * Pressing it submits. The form carries the state the row was rendered with and
 * the action flips that, rather than sending a new value, so a double press
 * cannot land two writes that disagree about where they started.
 */
function AutomationControl({ enabled, label }: { enabled: boolean; label: string }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Switch
      on={enabled}
      size="sm"
      label={t.invoices.automationAria(label)}
      title={enabled ? t.invoices.automationPauseHint : t.invoices.automationResumeHint}
      disabled={pending}
    />
  );
}

export function InvoiceAutomationSwitch({
  invoiceId,
  enabled,
  label,
}: {
  invoiceId: string;
  enabled: boolean;
  label: string;
}) {
  return (
    <form action={toggleInvoiceAutomation}>
      <input type="hidden" name="id" value={invoiceId} />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <AutomationControl enabled={enabled} label={label} />
    </form>
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
        className="tabular inline-flex min-h-11 items-center sm:min-h-0 underline-offset-2 transition hover:text-brand-600 hover:underline"
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
              {state.error}
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
    <button type="button" onClick={copy} className={`inline-flex min-h-11 items-center sm:min-h-0 text-sm ${subtleLinkClass}`}>
      {copied ? t.invoices.payLinkCopied : t.invoices.payLink}
    </button>
  );
}
