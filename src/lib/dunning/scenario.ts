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

export interface Scenario {
  steps: ScenarioStep[];
  repeat: ScenarioRepeat;
}

/** What a tenant gets before they have touched anything. */
export const DEFAULT_SCENARIO: Scenario = {
  steps: [
    { step: 'pre_due', enabled: true, offsetDays: -3, channels: ['email'] },
    { step: 'overdue_2', enabled: true, offsetDays: 2, channels: ['email', 'sms'] },
    { step: 'overdue_10', enabled: true, offsetDays: 10, channels: ['email', 'sms'] },
  ],
  repeat: { enabled: false, everyDays: 14, max: 3 },
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
 * The enabled steps in the order they actually fire.
 *
 * Sorted by offset rather than by enum order: a tenant may well decide the SMS
 * step should come before the polite one, and the windows below are built from
 * this order, not from what the steps are called.
 */
export function activeSteps(scenario: Scenario): ScenarioStep[] {
  return scenario.steps
    .filter((s) => s.enabled && s.channels.length > 0)
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
