'use client';

import { useActionState, useRef, useState } from 'react';

import { Badge, Button, Field, inputClass, subtleLinkClass } from '@/components/ui';
import { applyPlaceholders, PLACEHOLDERS, type TemplateContext } from '@/lib/dunning/templates';
import { useT } from '@/lib/i18n/provider';
import { segmentCount } from '@/lib/sms/send';

import { resetTemplate, saveTemplate, type SettingsState } from './actions';

export interface TemplateSlotView {
  key: string;
  label: string;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  /** True when the tenant has overridden this slot. */
  customised: boolean;
}

/**
 * Stand-in values for the preview.
 *
 * Realistic rather than `{{placeholder}}`-shaped: the point of a preview is to
 * show the sentence as a debtor will read it, and a line full of braces reads
 * nothing like the finished message.
 */
const SAMPLE: TemplateContext = {
  debtorName: 'Παπαδόπουλος ΑΕ',
  creditorName: 'Penny IKE',
  invoiceLabel: 'ΑΠΥ-Β-41',
  amountCents: 7000,
  currency: 'EUR',
  dueDate: '2026-08-04',
  payUrl: 'https://lefta.app/6JF5BN4Q8S',
};

function SlotEditor({ slot }: { slot: TemplateSlotView }) {
  const t = useT();
  const [saveState, save, saving] = useActionState<SettingsState, FormData>(saveTemplate, {});
  const [resetState, reset, resetting] = useActionState<SettingsState, FormData>(resetTemplate, {});
  const [open, setOpen] = useState(false);

  // Held in state so the preview tracks what is typed rather than what was last
  // saved — a preview that lags the textarea is worse than none.
  const [body, setBody] = useState(slot.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const state = saveState.error || saveState.success ? saveState : resetState;
  const preview = applyPlaceholders(body, SAMPLE);
  const segments = slot.channel === 'sms' ? segmentCount(preview) : 0;

  /** Drops a placeholder in at the cursor rather than at the end. */
  function insert(token: string) {
    const field = bodyRef.current;
    if (!field) return;

    const start = field.selectionStart ?? body.length;
    const end = field.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);

    setBody(next);
    // Restore the caret after React re-renders, so typing continues where the
    // author was rather than jumping to the end.
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-sm font-medium text-ink-900 transition hover:text-brand-600"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {slot.label}
        </button>
        <Badge tone={slot.customised ? 'info' : 'neutral'}>
          {slot.customised ? t.templates.custom : t.templates.default}
        </Badge>
      </div>

      {open ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <form action={save} className="space-y-3">
            <input type="hidden" name="slot" value={slot.key} />

            {slot.channel === 'email' ? (
              <Field label={t.templates.subject}>
                <input name="subject" defaultValue={slot.subject ?? ''} className={inputClass} />
              </Field>
            ) : null}

            <Field label={t.templates.body}>
              <textarea
                ref={bodyRef}
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={slot.channel === 'sms' ? 4 : 12}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </Field>

            <div>
              <p className="text-xs text-ink-500">{t.templates.insertHint}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => insert(p.token)}
                    title={p.label}
                    className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-ink-700 ring-1 ring-ink-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200"
                  >
                    {p.token}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? t.common.saving : t.common.save}
            </Button>

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
          </form>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                {t.templates.preview}
              </p>
              {slot.channel === 'sms' ? (
                <span className={`text-xs ${segments > 1 ? 'text-amber-700' : 'text-ink-500'}`}>
                  {t.templates.segments(segments)}
                </span>
              ) : null}
            </div>

            <div className="rounded-lg border border-ink-200 bg-white px-3 py-3">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-800">
                {preview}
              </pre>
            </div>

            <p className="text-xs text-ink-500">{t.templates.previewHint}</p>

            {slot.channel === 'sms' && segments > 1 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t.templates.segmentWarning}
              </p>
            ) : null}

            {slot.customised ? (
              <form action={reset}>
                <input type="hidden" name="slot" value={slot.key} />
                <button type="submit" disabled={resetting} className={`text-xs ${subtleLinkClass}`}>
                  {resetting ? t.templates.resetting : t.templates.reset}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The message copy, split by channel.
 *
 * Email and SMS were previously one flat list, which put a 12-line letter next
 * to a message that has to fit in 70 characters and gave no clue that the rules
 * differ. Grouping them makes the constraint visible before anything is typed.
 */
export function TemplateEditor({ slots }: { slots: TemplateSlotView[] }) {
  const t = useT();

  const groups = [
    {
      channel: 'email' as const,
      title: t.templates.emailGroup,
      hint: t.templates.emailGroupHint,
    },
    {
      channel: 'sms' as const,
      title: t.templates.smsGroup,
      hint: t.templates.smsGroupHint,
    },
  ];

  return (
    <>
      {groups.map((group) => {
        const inGroup = slots.filter((slot) => slot.channel === group.channel);
        if (inGroup.length === 0) return null;

        return (
          <div key={group.channel} className="border-t border-ink-100 first:border-t-0">
            <div className="bg-ink-50 px-5 py-3">
              <p className="text-sm font-medium text-ink-900">{group.title}</p>
              <p className="mt-0.5 text-xs text-ink-500">{group.hint}</p>
            </div>

            <ul className="divide-y divide-ink-100">
              {inGroup.map((slot) => (
                <SlotEditor key={slot.key} slot={slot} />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
