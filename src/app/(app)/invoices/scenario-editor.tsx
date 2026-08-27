'use client';

import { useState } from 'react';

import { Field, inputClass } from '@/components/ui';
import { FIELD } from '@/lib/dunning/invoice-scenario';
import type { Scenario } from '@/lib/dunning/scenario';
import { stepLabels } from '@/lib/dunning/step-labels';
import { useT } from '@/lib/i18n/provider';
import type { InvoiceScenarioMode } from '@/types/database';

/**
 * What happens to one invoice: the tenant's cadence, its own, or nothing.
 *
 * Deliberately smaller than the editor in settings. This is a decision taken
 * while doing something else — raising an invoice, or looking one up — so the
 * common answers are one tap and the detail only unfolds when somebody asks
 * for it. The account-wide editor is where a cadence gets designed.
 */
export function InvoiceScenarioEditor({
  scenario,
  mode: initialMode = 'default',
}: {
  /** The tenant's cadence, which is what `custom` starts from. */
  scenario: Scenario;
  mode?: InvoiceScenarioMode;
}) {
  const t = useT();
  const [mode, setMode] = useState<InvoiceScenarioMode>(initialMode);
  const stepLabel = stepLabels(t);

  const choices: Array<{ value: InvoiceScenarioMode; label: string; hint: string }> = [
    { value: 'default', label: t.invoiceScenario.modeDefault, hint: t.invoiceScenario.modeDefaultHint },
    { value: 'custom', label: t.invoiceScenario.modeCustom, hint: t.invoiceScenario.modeCustomHint },
    { value: 'off', label: t.invoiceScenario.modeOff, hint: t.invoiceScenario.modeOffHint },
  ];

  // Only the rungs a tenant actually placed. An invoice is not the place to
  // discover the five they never switched on.
  const placed = scenario.steps.filter((step) => step.enabled);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
              mode === choice.value
                ? 'border-brand-400 bg-brand-50/60'
                : 'border-ink-200 hover:border-ink-300'
            }`}
          >
            <input
              type="radio"
              name={FIELD.mode}
              value={choice.value}
              checked={mode === choice.value}
              onChange={() => setMode(choice.value)}
              className="mt-0.5 h-5 w-5 shrink-0 border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink-900">{choice.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                {choice.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {/* Rendered only under `custom`: the parser treats a field that is not
          there as "not overridden", which is exactly what the other two modes
          mean. Hiding it with CSS would submit rows nobody asked for. */}
      {mode === 'custom' ? (
        <div className="space-y-3 rounded-xl border border-ink-200 p-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
            <input
              type="checkbox"
              name={FIELD.enabled('on_issue')}
              defaultChecked={scenario.onIssue.enabled}
              className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            {t.scenario.onIssueEnabled}
          </label>

          <div className="flex flex-wrap gap-x-5">
            {(['email', 'sms'] as const).map((channel) => (
              <label
                key={channel}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-700"
              >
                <input
                  type="checkbox"
                  name={FIELD.channels('on_issue')}
                  value={channel}
                  defaultChecked={scenario.onIssue.channels.includes(channel)}
                  className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                />
                {channel === 'email' ? t.scenario.channelEmail : t.scenario.channelSms}
              </label>
            ))}
          </div>

          {placed.map((step) => (
            <div key={step.step} className="border-t border-ink-100 pt-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
                <input
                  type="checkbox"
                  name={FIELD.enabled(step.step)}
                  defaultChecked={step.enabled}
                  className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                />
                {stepLabel[step.step]}
              </label>

              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label={t.scenario.offsetLabel}>
                  <input
                    type="number"
                    name={FIELD.offset(step.step)}
                    defaultValue={step.offsetDays}
                    min={-30}
                    max={120}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </Field>

                <fieldset>
                  <legend className="mb-1 block text-xs font-medium text-ink-600">
                    {t.scenario.channels}
                  </legend>
                  <div className="flex flex-wrap gap-x-5">
                    {(['email', 'sms'] as const).map((channel) => (
                      <label
                        key={channel}
                        className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-700"
                      >
                        <input
                          type="checkbox"
                          name={FIELD.channels(step.step)}
                          value={channel}
                          defaultChecked={step.channels.includes(channel)}
                          className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                        />
                        {channel === 'email' ? t.scenario.channelEmail : t.scenario.channelSms}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          ))}

          <p className="text-xs leading-relaxed text-ink-500">{t.invoiceScenario.customHint}</p>
        </div>
      ) : null}
    </div>
  );
}
