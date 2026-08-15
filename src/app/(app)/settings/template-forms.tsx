'use client';

import { useActionState, useState } from 'react';

import { Badge, Button, Field, inputClass, subtleLinkClass } from '@/components/ui';
import { PLACEHOLDERS } from '@/lib/dunning/templates';
import { useT } from '@/lib/i18n/provider';

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

function SlotEditor({ slot }: { slot: TemplateSlotView }) {
  const t = useT();
  const [saveState, save, saving] = useActionState<SettingsState, FormData>(saveTemplate, {});
  const [resetState, reset, resetting] = useActionState<SettingsState, FormData>(
    resetTemplate,
    {},
  );
  const [open, setOpen] = useState(false);

  const state = saveState.error || saveState.success ? saveState : resetState;

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
        <div className="mt-4 space-y-3">
          <form action={save} className="space-y-3">
            <input type="hidden" name="slot" value={slot.key} />

            {slot.channel === 'email' ? (
              <Field label={t.templates.subject}>
                <input name="subject" defaultValue={slot.subject ?? ''} className={inputClass} />
              </Field>
            ) : null}

            <Field label={t.templates.body}>
              <textarea
                name="body"
                defaultValue={slot.body}
                rows={slot.channel === 'sms' ? 3 : 10}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </Field>

            {slot.channel === 'sms' ? (
              <p className="text-xs text-ink-500">
                {t.templates.smsHint}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? t.common.saving : t.common.save}
              </Button>
            </div>
          </form>

          {slot.customised ? (
            <form action={reset}>
              <input type="hidden" name="slot" value={slot.key} />
              <button type="submit" disabled={resetting} className={`text-xs ${subtleLinkClass}`}>
                {resetting ? t.templates.resetting : t.templates.reset}
              </button>
            </form>
          ) : null}

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
        </div>
      ) : null}
    </li>
  );
}

export function TemplateEditor({ slots }: { slots: TemplateSlotView[] }) {
  const t = useT();
  return (
    <>
      <div className="border-b border-ink-100 bg-ink-50 px-5 py-3">
        <p className="text-xs text-ink-600">
          {t.templates.placeholders}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <code
              key={p.token}
              title={p.label}
              className="rounded bg-white px-1.5 py-0.5 text-xs text-ink-700 ring-1 ring-ink-200"
            >
              {p.token}
            </code>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-ink-100">
        {slots.map((slot) => (
          <SlotEditor key={slot.key} slot={slot} />
        ))}
      </ul>
    </>
  );
}
