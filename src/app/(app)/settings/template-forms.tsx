'use client';

import { useActionState, useState } from 'react';

import { Button, Field, inputClass } from '@/components/ui';
import { PLACEHOLDERS } from '@/lib/dunning/templates';

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
          className="text-left text-sm font-medium text-ink-900 hover:underline"
        >
          {slot.label}
        </button>
        <span className="shrink-0 text-xs text-ink-500">
          {slot.customised ? 'Προσαρμοσμένο' : 'Προεπιλογή'}
        </span>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <form action={save} className="space-y-3">
            <input type="hidden" name="slot" value={slot.key} />

            {slot.channel === 'email' ? (
              <Field label="Θέμα">
                <input name="subject" defaultValue={slot.subject ?? ''} className={inputClass} />
              </Field>
            ) : null}

            <Field label="Κείμενο">
              <textarea
                name="body"
                defaultValue={slot.body}
                rows={slot.channel === 'sms' ? 3 : 10}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </Field>

            {slot.channel === 'sms' ? (
              <p className="text-xs text-ink-500">
                Τα ελληνικά SMS χρεώνονται ανά 70 χαρακτήρες. Κρατήστε το σύντομο.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </Button>
            </div>
          </form>

          {slot.customised ? (
            <form action={reset}>
              <input type="hidden" name="slot" value={slot.key} />
              <button
                type="submit"
                disabled={resetting}
                className="text-xs font-medium text-ink-500 hover:text-ink-800 hover:underline disabled:opacity-50"
              >
                {resetting ? 'Επαναφορά…' : 'Επαναφορά προεπιλογής'}
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
  return (
    <>
      <div className="border-b border-ink-100 bg-ink-50 px-5 py-3">
        <p className="text-xs text-ink-600">
          Διαθέσιμες μεταβλητές — αντιγράψτε τις μέσα στο κείμενο:
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
