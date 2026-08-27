import { DICTIONARIES, type Dictionary } from '@/lib/i18n/dictionaries';
import { athensDate, daysBetween } from '@/lib/money';
import type { DunningStep, InvoiceRow } from '@/types/database';

import { LADDER, stepForInvoice } from './engine';

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

export interface WorkflowStatus {
  label: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger' | 'info';
  daysOverdue: number;
}

/**
 * The workflow state to show for an invoice.
 *
 * Derived, never stored: the ladder position is a pure function of the due date
 * and the steps already recorded, so the dashboard can never drift out of sync
 * with what the engine will actually do tonight.
 *
 * The dictionary is a parameter rather than resolved inside, because this runs
 * once per row: fetching the tenant's language per invoice would turn a table
 * render into a query storm. Callers resolve it once and pass it down.
 */
export function workflowStatus(
  invoice: Pick<InvoiceRow, 'status' | 'due_date'>,
  completedSteps: ReadonlySet<DunningStep>,
  today: string = athensDate(),
  t: Dictionary = DICTIONARIES.el,
): WorkflowStatus {
  const daysOverdue = daysBetween(invoice.due_date, today);
  const short = stepShort(t);

  if (invoice.status === 'paid') return { label: t.workflow.paid, tone: 'positive', daysOverdue };
  if (invoice.status === 'cancelled') {
    return { label: t.workflow.cancelled, tone: 'neutral', daysOverdue };
  }
  if (invoice.status === 'written_off') {
    return { label: t.workflow.writtenOff, tone: 'neutral', daysOverdue };
  }

  const lastDone = [...LADDER].reverse().find((rung) => completedSteps.has(rung.step));

  if (lastDone) {
    const isFinal = lastDone.step === 'overdue_10';
    return {
      label: isFinal
        ? t.workflow.stepSentFinal(short[lastDone.step])
        : t.workflow.stepSent(short[lastDone.step]),
      tone: isFinal ? 'danger' : 'warning',
      daysOverdue,
    };
  }

  const pending = stepForInvoice(invoice.due_date, today);
  if (pending) {
    return {
      label: t.workflow.stepPending(short[pending.step]),
      tone: pending.step === 'pre_due' ? 'info' : 'warning',
      daysOverdue,
    };
  }

  if (daysOverdue > 0) {
    return { label: t.workflow.daysOverdue(daysOverdue), tone: 'danger', daysOverdue };
  }

  return { label: t.workflow.dueInDays(Math.abs(daysOverdue)), tone: 'neutral', daysOverdue };
}
