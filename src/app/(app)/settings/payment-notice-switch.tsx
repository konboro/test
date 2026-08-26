'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Switch } from '@/components/switch';
import { useT } from '@/lib/i18n/provider';

import { setPaymentNotice, type SettingsState } from './actions';

/**
 * Whether a settled invoice sends the creditor an email.
 *
 * No confirmation either way, unlike the automation switch. That one starts an
 * engine that contacts customers; this one only decides whether the operator
 * hears about money that has already arrived, and both directions are undone by
 * pressing it again.
 */
function Control({ on }: { on: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();

  return <Switch on={on} label={t.settings.paymentNotice.title} disabled={pending} />;
}

export function PaymentNoticeSwitch({ enabled }: { enabled: boolean }) {
  const t = useT();
  const [state, action] = useActionState<SettingsState, FormData>(setPaymentNotice, {});

  return (
    <form action={action} className="space-y-4 px-5 py-5">
      {/* Carries what the click switches *to*, so a tab a revalidation behind
          cannot turn something back on that was just turned off. */}
      <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-900">{t.settings.paymentNotice.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {t.settings.paymentNotice.hint}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <Control on={enabled} />
          <span className={`text-xs font-medium ${enabled ? 'text-emerald-700' : 'text-ink-500'}`}>
            {enabled ? t.settings.paymentNotice.on : t.settings.paymentNotice.off}
          </span>
        </div>
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
    </form>
  );
}
