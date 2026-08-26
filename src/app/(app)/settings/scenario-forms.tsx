'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import type { Scenario } from '@/lib/dunning/scenario';
import { useT } from '@/lib/i18n/provider';
import type { DunningStep } from '@/types/database';

import { saveScenario, type ScenarioState } from './scenario-actions';

function Submit({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/**
 * Editing the cadence a customer experiences.
 *
 * Every input here has a matching check constraint in the database. The form is
 * the polite half of that: it shows the bounds rather than letting someone save
 * a scenario the database will refuse, but it is not what enforces them.
 */
export function ScenarioForm({ scenario }: { scenario: Scenario }) {
  const t = useT();
  const [state, action] = useActionState<ScenarioState, FormData>(saveScenario, {});

  const stepLabel: Record<DunningStep, string> = {
    pre_due: t.steps.longPreDue,
    overdue_2: t.steps.longOverdue2,
    overdue_10: t.steps.longOverdue10,
  };

  return (
    <form action={action} className="space-y-5 px-5 py-4">
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        {t.scenario.guarantee}
      </p>

      <div className="space-y-4">
        {scenario.steps.map((step) => (
          <div key={step.step} className="rounded-xl border border-ink-200 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
              <input
                type="checkbox"
                name={`${step.step}_enabled`}
                defaultChecked={step.enabled}
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              {stepLabel[step.step]}
            </label>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label={t.scenario.offsetLabel}>
                <input
                  type="number"
                  name={`${step.step}_offset`}
                  defaultValue={step.offsetDays}
                  min={-30}
                  max={120}
                  className={inputClass}
                />
              </Field>

              <fieldset>
                <legend className="mb-1.5 block text-xs font-medium text-ink-600">
                  {t.scenario.channels}
                </legend>
                {/* Named explicitly rather than implied by the step, because which
                    channel a reminder uses is the part a customer actually feels. */}
                <div className="flex gap-4">
                  {(['email', 'sms'] as const).map((channel) => (
                    <label key={channel} className="flex items-center gap-2 text-sm text-ink-700">
                      <input
                        type="checkbox"
                        name={`${step.step}_channels`}
                        value={channel}
                        defaultChecked={step.channels.includes(channel)}
                        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                      />
                      {channel === 'email' ? t.scenario.channelEmail : t.scenario.channelSms}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-ink-500">{t.scenario.noChannel}</p>
              </fieldset>
            </div>
          </div>
        ))}
      </div>

      {/* When, rather than whether. The steps above decide which day a reminder
          falls on; this decides what time of day it leaves. */}
      <div className="rounded-xl border border-ink-200 p-4">
        <Field label={t.scenario.sendHour} hint={t.scenario.sendHourHint}>
          <select name="send_hour" defaultValue={String(scenario.sendHour)} className={inputClass}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {`${String(hour).padStart(2, '0')}:00`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="rounded-xl border border-ink-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
          <input
            type="checkbox"
            name="repeat_enabled"
            defaultChecked={scenario.repeat.enabled}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {t.scenario.repeatEnabled}
        </label>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={t.scenario.repeatEvery}>
            <input
              type="number"
              name="repeat_every_days"
              defaultValue={scenario.repeat.everyDays}
              min={7}
              max={90}
              className={inputClass}
            />
          </Field>
          <Field label={t.scenario.repeatMax}>
            <input
              type="number"
              name="repeat_max"
              defaultValue={scenario.repeat.max}
              min={1}
              max={6}
              className={inputClass}
            />
          </Field>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-500">{t.scenario.repeatHint}</p>
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

      <Submit label={t.scenario.save} />
    </form>
  );
}
