'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

import { setAutomation, type SettingsState } from './actions';

/**
 * The switch itself.
 *
 * Asymmetric on purpose. Switching off is one click and takes effect at once —
 * stopping the messages is never the dangerous direction, and putting a dialog
 * in front of it is how someone ends up watching reminders go out while they
 * click through a confirmation. Switching on asks first.
 */
function Control({ on, onRequestEnable }: { on: boolean; onRequestEnable: () => void }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <button
      // Off → on goes through the confirmation panel, so the control is only a
      // submit button in the direction that needs no confirming.
      type={on ? 'submit' : 'button'}
      onClick={on ? undefined : onRequestEnable}
      role="switch"
      aria-checked={on}
      aria-label={t.settings.automation.title}
      disabled={pending}
      className={`relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
        on ? 'bg-emerald-500' : 'bg-ink-300'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-7 w-7 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? 'translate-x-8' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function ConfirmButton() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.fields.saving : t.settings.automation.confirmYes}
    </Button>
  );
}

export function AutomationSwitch({
  enabled,
  openInvoices,
}: {
  enabled: boolean;
  openInvoices: number;
}) {
  const t = useT();
  const [state, action] = useActionState<SettingsState, FormData>(setAutomation, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action} className="space-y-4 px-5 py-5">
      {/*
        Carries what the click switches *to*, not what is currently shown. The
        server then never has to infer the new value from a control that may be
        a revalidation behind, which is how a stale tab could otherwise re-enable
        something the operator had just switched off.
      */}
      <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-900">{t.fields.automationOn}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{t.fields.automationHint}</p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <Control on={enabled} onRequestEnable={() => setConfirming(true)} />
          <span
            className={`text-xs font-medium ${enabled ? 'text-emerald-700' : 'text-ink-500'}`}
          >
            {enabled ? t.settings.automation.stateOn : t.settings.automation.stateOff}
          </span>
        </div>
      </div>

      {/*
        Tied to `enabled` as well as to the local flag, so a successful enable
        clears the panel on its own when the page revalidates.
      */}
      {!enabled && confirming ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-ink-900">
            {t.settings.automation.confirmTitle}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
            {t.settings.automation.confirmBody(openInvoices)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ConfirmButton />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50"
            >
              {t.settings.automation.cancel}
            </button>
          </div>
        </div>
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
    </form>
  );
}
