'use client';

import { useState } from 'react';

import { Switch } from '@/components/switch';
import { Field, inputClass } from '@/components/ui';
import { FIELD } from '@/lib/dunning/invoice-scenario';
import type { Scenario } from '@/lib/dunning/scenario';
import { stepLabels } from '@/lib/dunning/step-labels';
import { useT } from '@/lib/i18n/provider';
import type { DunningStep, InvoiceScenarioMode } from '@/types/database';

/**
 * What happens to one invoice: chased automatically, or not.
 *
 * One switch, not a three-way choice. The old form asked the operator to
 * classify their intent — my scenario / something different / nothing — before
 * showing them anything, and the honest answer to "which is it?" is usually
 * "show me the schedule and I'll tell you". So the schedule is simply there
 * whenever the switch is on, prefilled from the account, and editing it is
 * what makes it this invoice's own. The distinction the radios used to ask
 * for is read off the values on save: untouched means "follow the settings,
 * now and in the future", touched means "this document, these values".
 */
export function InvoiceScenarioEditor({
  scenario,
  mode: initialMode = 'default',
  show,
}: {
  /**
   * The cadence to prefill: the account's, or — on an invoice that already
   * has one of its own — the effective merge of the two, so what is on screen
   * is what tomorrow's sweep will actually do.
   */
  scenario: Scenario;
  mode?: InvoiceScenarioMode;
  /**
   * Which rungs to render; defaults to the ones enabled in `scenario`. The
   * invoice page passes the union of account-placed and invoice-enabled steps:
   * a rung this invoice switched OFF is disabled in the effective cadence, and
   * deriving the list from enablement alone would drop it from the screen —
   * after which an untouched save reads as "same as the account" and quietly
   * erases the very override that hid it.
   */
  show?: ReadonlyArray<DunningStep>;
}) {
  const t = useT();
  const [on, setOn] = useState(initialMode !== 'off');
  const stepLabel = stepLabels(t);

  // Only the rungs a tenant actually placed. An invoice is not the place to
  // discover the five they never switched on.
  const placed = scenario.steps.filter((step) =>
    show ? show.includes(step.step) : step.enabled,
  );

  return (
    <div className="space-y-3">
      {/* Always `custom` while on: the parser collapses values identical to
          the account cadence back to `default`, so the wire keeps the three
          stored meanings while the screen only ever asks one question. */}
      <input type="hidden" name={FIELD.mode} value={on ? 'custom' : 'off'} />

      <div className="flex items-start gap-3">
        <Switch
          on={on}
          submit={false}
          onClick={() => setOn((value) => !value)}
          size="sm"
          label={t.invoiceScenario.title}
        />
        {/* The words toggle too — a switch this small is a poor tap target on
            its own, and the sentence beside it is what the thumb is aimed at. */}
        <button
          type="button"
          onClick={() => setOn((value) => !value)}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="block text-sm font-medium text-ink-900">
            {t.invoiceScenario.title}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
            {on ? t.invoiceScenario.switchOnHint : t.invoiceScenario.switchOffHint}
          </span>
        </button>
      </div>

      {/* Rendered only while on: the parser treats a field that is not there
          as "not overridden", which is exactly what off means. Hiding it with
          CSS would submit rows nobody asked for. */}
      {on ? (
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

          <p className="text-xs leading-relaxed text-ink-500">
            {t.invoiceScenario.prefillNote} {t.invoiceScenario.customHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}
