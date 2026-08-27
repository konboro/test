'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import type { Scenario, ScenarioStep } from '@/lib/dunning/scenario';
import { stepLabels } from '@/lib/dunning/step-labels';
import { useT } from '@/lib/i18n/provider';
import type { DunningStep } from '@/types/database';

import { saveScenario, type ScenarioState } from './scenario-actions';

function Submit({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? t.common.saving : label}
    </Button>
  );
}

/** A checkbox with a hit area big enough for a thumb. */
function Check({
  name,
  value,
  defaultChecked,
  children,
}: {
  name: string;
  value?: string;
  defaultChecked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-700">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
      />
      {children}
    </label>
  );
}

function Channels({ step, channels }: { step: string; channels: ReadonlyArray<string> }) {
  const t = useT();

  return (
    <fieldset>
      <legend className="mb-1 block text-xs font-medium text-ink-600">{t.scenario.channels}</legend>
      {/* Named explicitly rather than implied by the step, because which channel
          a reminder uses is the part a customer actually feels. */}
      <div className="flex flex-wrap gap-x-5">
        {(['email', 'sms'] as const).map((channel) => (
          <Check
            key={channel}
            name={`${step}_channels`}
            value={channel}
            defaultChecked={channels.includes(channel)}
          >
            {channel === 'email' ? t.scenario.channelEmail : t.scenario.channelSms}
          </Check>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One rung: whether it fires, when, and on what.
 *
 * A removed rung is not unmounted — its inputs stay in the form, hidden and
 * switched off. Unmounting them would submit a form with no fields for that
 * step, and the action would then read the day it fires as absent and reset it.
 * Hiding keeps "I turned this off" and "I never touched this" the same thing.
 */
function StepCard({
  step,
  label,
  hidden,
  onRemove,
}: {
  step: ScenarioStep;
  label: string;
  hidden: boolean;
  onRemove: () => void;
}) {
  const t = useT();

  return (
    <div
      className={`rounded-xl border border-ink-200 p-4 ${hidden ? 'hidden' : ''}`}
      aria-hidden={hidden}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
          <input
            type="checkbox"
            name={`${step.step}_enabled`}
            defaultChecked={step.enabled}
            className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {label}
        </label>

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 py-2 text-sm text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
        >
          {t.scenario.removeStep}
        </button>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label={t.scenario.offsetLabel}>
          <input
            type="number"
            name={`${step.step}_offset`}
            defaultValue={step.offsetDays}
            min={-30}
            max={120}
            inputMode="numeric"
            className={inputClass}
          />
        </Field>

        <Channels step={step.step} channels={step.channels} />
      </div>

      <p className="mt-1.5 text-xs text-ink-500">{t.scenario.noChannel}</p>
    </div>
  );
}

/**
 * Editing the cadence a customer experiences.
 *
 * Every input here has a matching check constraint in the database. The form is
 * the polite half of that: it shows the bounds rather than letting someone save
 * a scenario the database will refuse, but it is not what enforces them.
 */
export function ScenarioForm({
  scenario,
  hourlySweepOn,
}: {
  scenario: Scenario;
  /**
   * Whether the sweep actually runs more than once a day.
   *
   * The hour is editable either way — it is a real setting, saved and used the
   * moment hourly sending is switched on — but a control that quietly does
   * nothing today should say so rather than imply a precision it has not got.
   */
  hourlySweepOn: boolean;
}) {
  const t = useT();
  const [state, action] = useActionState<ScenarioState, FormData>(saveScenario, {});

  const stepLabel = stepLabels(t);

  // Which rungs are on the page. A rung a tenant has never placed is not shown
  // until they ask for it: eight cards, five of them empty, is a wall rather
  // than a scenario.
  const [shown, setShown] = useState<ReadonlySet<DunningStep>>(
    () => new Set(scenario.steps.filter((step) => step.enabled).map((step) => step.step)),
  );

  const hidden = scenario.steps.filter((step) => !shown.has(step.step));
  const next = hidden[0];

  return (
    <form action={action} className="space-y-5 px-4 py-4 sm:px-5">
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        {t.scenario.guarantee}
      </p>

      {/* First in the form because it is first in the customer's experience:
          they hear about the invoice before they are ever reminded of it. */}
      <div className="rounded-xl border border-ink-200 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          {t.scenario.onIssueTitle}
        </p>

        <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
          <input
            type="checkbox"
            name="on_issue_enabled"
            defaultChecked={scenario.onIssue.enabled}
            className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {t.scenario.onIssueEnabled}
        </label>

        <div className="mt-3">
          <Channels step="on_issue" channels={scenario.onIssue.channels} />
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-500">{t.scenario.onIssueHint}</p>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          {t.scenario.ladderTitle}
        </p>

        {scenario.steps.map((step) => (
          <StepCard
            key={step.step}
            step={step}
            label={stepLabel[step.step]}
            hidden={!shown.has(step.step)}
            onRemove={() =>
              setShown((current) => {
                const without = new Set(current);
                without.delete(step.step);
                return without;
              })
            }
          />
        ))}

        {next ? (
          <button
            type="button"
            onClick={() => setShown((current) => new Set(current).add(next.step))}
            className="min-h-11 w-full rounded-xl border border-dashed border-ink-300 px-4 text-sm font-medium text-ink-600 transition hover:border-ink-400 hover:text-ink-800"
          >
            {t.scenario.addStep}
          </button>
        ) : (
          <p className="text-xs text-ink-500">{t.scenario.stepsFull}</p>
        )}
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

        {hourlySweepOn ? null : (
          <p className="mt-2 text-xs leading-relaxed text-amber-700">
            {t.scenario.sendHourInactive}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-ink-200 p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
          <input
            type="checkbox"
            name="repeat_enabled"
            defaultChecked={scenario.repeat.enabled}
            className="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
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
              inputMode="numeric"
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
              inputMode="numeric"
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
