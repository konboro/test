/**
 * When each reminder fires, on which channel, and whether it repeats.
 *
 * Pure: no database, no clock. The whole cadence a debtor experiences is decided
 * here, which is exactly the code that should be testable without a tenant.
 *
 * The ladder used to be a constant, and the reason it was fixed still holds — a
 * bounded, predictable cadence is what keeps this a software provider rather
 * than a collections operation. Configuration does not change that; it moves the
 * bounds into the database, where the application cannot argue with them. This
 * module only has to respect what it is given.
 */

import type { DunningStep } from '@/types/database';

export type Channel = 'email' | 'sms';

export interface ScenarioStep {
  step: DunningStep;
  enabled: boolean;
  /** Days from the due date; negative is before it. */
  offsetDays: number;
  channels: Channel[];
}

export interface ScenarioRepeat {
  enabled: boolean;
  everyDays: number;
  max: number;
}

/**
 * The notice that goes out when the invoice is raised.
 *
 * Not a rung: it has no offset because it is not measured from the due date,
 * and it does not compete for a window with anything. It is here rather than in
 * its own module because a tenant thinks of it as the first thing the scenario
 * does, and splitting it would only mean two places to look.
 */
export interface ScenarioNotice {
  enabled: boolean;
  channels: Channel[];
}

export interface Scenario {
  onIssue: ScenarioNotice;
  steps: ScenarioStep[];
  repeat: ScenarioRepeat;
  /** Local Europe/Athens hour, 0-23, at which the sweep may act for this tenant. */
  sendHour: number;
}

/**
 * Every rung a scenario may place, in the order the editor shows them.
 *
 * The first three are named after what they once were; the rest never had a
 * meaning to lose. Order here is presentation only — the engine sorts by the
 * offsets a tenant actually chose.
 */
export const LADDER_STEPS: ReadonlyArray<DunningStep> = [
  'pre_due',
  'overdue_2',
  'overdue_10',
  'step_4',
  'step_5',
  'step_6',
  'step_7',
  'step_8',
];

/**
 * Where an unplaced rung sits the first time somebody switches it on.
 *
 * These are off until chosen, so the numbers are not a cadence anybody receives
 * — they are what the editor proposes, spread out rather than stacked on the
 * step above so that enabling one does not silently create two reminders on the
 * same day.
 */
export const EXTRA_STEP_OFFSETS: Readonly<Record<string, number>> = {
  step_4: 20,
  step_5: 30,
  step_6: 45,
  step_7: 60,
  step_8: 90,
};

/** What a tenant gets before they have touched anything. */
export const DEFAULT_SCENARIO: Scenario = {
  // Email only. An SMS the moment an invoice is raised costs money to tell
  // somebody something they are not yet late for.
  onIssue: { enabled: true, channels: ['email'] },
  steps: [
    // The day before, not three days before: close enough to be the thing that
    // reminds someone to pay, far enough not to arrive as a demand.
    { step: 'pre_due', enabled: true, offsetDays: -1, channels: ['email'] },
    { step: 'overdue_2', enabled: true, offsetDays: 3, channels: ['email', 'sms'] },
    { step: 'overdue_10', enabled: true, offsetDays: 10, channels: ['email', 'sms'] },
  ],
  repeat: { enabled: false, everyDays: 14, max: 3 },
  // The start of the working day. A reminder landing at 07:00 is buried by the
  // time anybody opens their inbox.
  sendHour: 9,
};

/** Stop chasing entirely once an invoice is this far past due. */
export const ABANDON_AFTER_DAYS = 120;

export interface Rung {
  step: DunningStep;
  channels: Channel[];
  /** 0 is the first pass; a repeat increments it, and the pair is unique per invoice. */
  cycle: number;
  daysOverdue: number;
}

/**
 * A tenant's scenario with one invoice's changes laid over it.
 *
 * Only the rungs and the notice are overridable. The repeat and the sending
 * hour stay the tenant's: the hour is a property of when the sweep runs for a
 * whole account, not of a document, and letting one invoice claim a different
 * one would describe something the engine cannot do.
 *
 * A step with no row keeps whatever the tenant set, so an override that changes
 * one reminder does not silently freeze the rest at the day they were on when
 * it was written.
 */
export function scenarioWithOverrides(
  base: Scenario,
  rows: ReadonlyArray<{
    step: DunningStep;
    enabled: boolean;
    offset_days: number;
    channels: Channel[];
  }>,
): Scenario {
  if (rows.length === 0) return base;

  const override = new Map(rows.map((row) => [row.step, row]));
  const issue = override.get('on_issue');

  return {
    ...base,
    onIssue: issue ? { enabled: issue.enabled, channels: issue.channels } : base.onIssue,
    steps: base.steps.map((step) => {
      const row = override.get(step.step);
      if (!row) return step;

      return {
        step: step.step,
        enabled: row.enabled,
        offsetDays: row.offset_days,
        channels: row.channels,
      };
    }),
  };
}

/**
 * The enabled steps in the order they actually fire.
 *
 * Sorted by offset rather than by enum order: a tenant may well decide the SMS
 * step should come before the polite one, and the windows below are built from
 * this order, not from what the steps are called.
 */
export function activeSteps(scenario: Scenario): ScenarioStep[] {
  return scenario.steps
    // `on_issue` is not placed on this ladder. It has no offset to sort by and
    // no window to own; a copy of it stored among the steps would be handed a
    // window here and fire twice.
    .filter((s) => s.step !== 'on_issue' && s.enabled && s.channels.length > 0)
    .sort((a, b) => a.offsetDays - b.offsetDays);
}

/**
 * Which reminder, if any, an invoice is due for today.
 *
 * Each step owns a window that runs until the next one begins, so a missed cron
 * run is caught up on the following day instead of being skipped — the same
 * property the fixed ladder had, now derived rather than written out.
 */
export function rungFor(daysOverdue: number, scenario: Scenario): Rung | null {
  if (daysOverdue > ABANDON_AFTER_DAYS) return null;

  const steps = activeSteps(scenario);
  if (!steps.length) return null;

  const last = steps[steps.length - 1];
  if (!last) return null;

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    if (!current) continue;

    const next = steps[i + 1];
    const isLast = !next;

    // The final step normally runs to the end. With repeats on it only holds the
    // days before the first repeat is due, or the two would both claim them.
    const openEnd = scenario.repeat.enabled
      ? current.offsetDays + scenario.repeat.everyDays - 1
      : Number.POSITIVE_INFINITY;

    // A step set before the due date closes on the day before it, whatever comes
    // next. The original ladder wrote this out — pre_due ran −3 to −1 — and it is
    // deliberate: the due date itself and the day after are left quiet, because a
    // reminder that lands the morning something falls due reads as chasing
    // someone who is not yet late. Deriving the window from the following step
    // would quietly hand those two days away.
    const until = current.offsetDays < 0
      ? Math.min(next ? next.offsetDays - 1 : -1, -1)
      : next
        ? next.offsetDays - 1
        : openEnd;

    if (daysOverdue >= current.offsetDays && daysOverdue <= until) {
      return { step: current.step, channels: current.channels, cycle: 0, daysOverdue };
    }

    if (isLast) break;
  }

  if (!scenario.repeat.enabled) return null;

  // Past the last step, the same wording comes round again on a fixed interval —
  // bounded by `max`, after which the invoice is left alone even though it is
  // still unpaid. An unbounded loop is what the fixed ladder existed to rule out.
  const since = daysOverdue - last.offsetDays;
  if (since < scenario.repeat.everyDays) return null;

  const cycle = Math.floor(since / scenario.repeat.everyDays);
  if (cycle < 1 || cycle > scenario.repeat.max) return null;

  return { step: last.step, channels: last.channels, cycle, daysOverdue };
}
