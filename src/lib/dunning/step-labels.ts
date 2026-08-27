import { type Dictionary } from '@/lib/i18n/dictionaries';
import type { DunningStep } from '@/types/database';

/**
 * What each rung is called, in the reader's language.
 *
 * Its own module because both the settings editor and the invoice list need it,
 * and one of them runs in the browser. Left in `status`, a client component
 * asking for a step name pulled the whole engine in behind it — and the engine
 * reaches for the database, the mailer and `next/headers`, none of which exist
 * there. The build said so plainly.
 */

/**
 * The rungs past the original three, numbered from their identifier.
 *
 * `step_4` and up were never given names because there is nothing to name: they
 * are whatever a tenant places them at. Deriving the number from the identifier
 * keeps one list instead of five dictionary entries per language that only ever
 * differ by a digit.
 */
function extraNumber(step: DunningStep): number | null {
  const match = /^step_(\d)$/.exec(step);
  return match?.[1] ? Number(match[1]) : null;
}

export function stepLabels(t: Dictionary): Record<DunningStep, string> {
  return {
    on_issue: t.steps.longOnIssue,
    pre_due: t.steps.longPreDue,
    overdue_2: t.steps.longOverdue2,
    overdue_10: t.steps.longOverdue10,
    step_4: t.steps.longExtra(4),
    step_5: t.steps.longExtra(5),
    step_6: t.steps.longExtra(6),
    step_7: t.steps.longExtra(7),
    step_8: t.steps.longExtra(8),
  };
}

export function stepShort(t: Dictionary): Record<DunningStep, string> {
  return {
    on_issue: t.steps.shortOnIssue,
    pre_due: t.steps.shortPreDue,
    overdue_2: t.steps.shortOverdue2,
    overdue_10: t.steps.shortOverdue10,
    step_4: t.steps.shortExtra(4),
    step_5: t.steps.shortExtra(5),
    step_6: t.steps.shortExtra(6),
    step_7: t.steps.shortExtra(7),
    step_8: t.steps.shortExtra(8),
  };
}

/** One step's short label, for code that has a step rather than the whole map. */
export function shortLabelFor(t: Dictionary, step: DunningStep): string {
  const extra = extraNumber(step);
  return extra ? t.steps.shortExtra(extra) : stepShort(t)[step];
}
