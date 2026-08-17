'use client';

import { useT } from '@/lib/i18n/provider';

import { updatePaymentProvider } from './actions';

/**
 * Which provider the payment button uses when both are set up.
 *
 * Submits on change rather than behind a save button: there is one field and
 * three states, so a separate confirmation step would only create a way to
 * think the choice was made when it was not.
 */
export function ProviderChooser({ current }: { current: string | null }) {
  const t = useT();

  return (
    <form action={updatePaymentProvider} className="px-5 py-4">
      <fieldset className="space-y-2">
        <legend className="sr-only">{t.settings.providerTitle}</legend>

        {[
          { value: '', label: t.settings.providerAuto, hint: t.settings.providerAutoHint },
          { value: 'stripe', label: 'Stripe', hint: t.settings.providerStripeHint },
          { value: 'viva', label: 'Viva.com', hint: t.settings.providerVivaHint },
        ].map((option) => (
          <label
            key={option.value || 'auto'}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 px-3 py-2.5 transition hover:bg-ink-50 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name="payment_provider"
              value={option.value}
              defaultChecked={(current ?? '') === option.value}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="mt-0.5 accent-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink-900">{option.label}</span>
              <span className="block text-xs text-ink-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </form>
  );
}
