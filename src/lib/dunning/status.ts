import { DICTIONARIES, type Dictionary } from '@/lib/i18n/dictionaries';
import { athensDate, daysBetween, formatDayMonth } from '@/lib/money';
import type { DunningStep, InvoiceRow } from '@/types/database';

import { stepForInvoice } from './engine';
import { stepShort } from './step-labels';
import {
  activeSteps,
  DEFAULT_SCENARIO,
  LADDER_STEPS,
  nextScheduledRung,
  type Scenario,
} from './scenario';

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
  /**
   * The tenant's cadence. Without it this describes the built-in one, which is
   * right for a tenant who never configured anything and wrong for one who did
   * — so callers that have already loaded a scenario should pass it.
   */
  scenario: Scenario = DEFAULT_SCENARIO,
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

  // Ordered by the ladder's own order, so a rung past the original three counts
  // as later than one before it. The notice on issue is not on this list and so
  // never reads as a step of the chase, which is exactly right: being told an
  // invoice exists is not being chased for it.
  const placed = activeSteps(scenario).map((step) => step.step);
  const order = placed.length ? placed : [...LADDER_STEPS];
  const lastDone = [...order].reverse().find((step) => completedSteps.has(step));

  if (lastDone) {
    // The last rung the tenant actually placed, not a name hard-coded here.
    const isFinal = lastDone === order[order.length - 1] && !scenario.repeat.enabled;
    return {
      label: isFinal
        ? t.workflow.stepSentFinal(short[lastDone])
        : t.workflow.stepSent(short[lastDone]),
      tone: isFinal ? 'danger' : 'warning',
      daysOverdue,
    };
  }

  // What is coming, and when. Computed once because all three branches below
  // want it: an invoice with a step due today, one not due yet, and one sitting
  // in a gap between rungs are three different states, but the useful thing to
  // say about each is the same — the next date something happens.
  const upcoming = nextScheduledRung(invoice.due_date, today, scenario, completedSteps);

  const pending = stepForInvoice(invoice.due_date, today, scenario);
  if (pending) {
    const on = upcoming?.step === pending.step ? upcoming.on : today;

    return {
      label: t.workflow.stepOn(short[pending.step], formatDayMonth(on, t.dateTimeTag)),
      tone: pending.step === 'pre_due' ? 'info' : 'warning',
      daysOverdue,
    };
  }

  // Nothing on the ladder applies to this invoice. These branches used to answer
  // with the number of days late — which is the aging column, one cell to the
  // left, saying the same thing in different words. This column's subject is
  // what the chase is doing, so when it is doing nothing it says why.

  // Sitting between two rungs, or waiting for the first one. Neither is
  // "nothing scheduled" if a rung is genuinely coming, and the date is the
  // whole answer: an invoice three days late with the next step on the 13th is
  // not a problem, and one with no step at all is.
  if (upcoming) {
    return {
      label: t.workflow.stepOn(short[upcoming.step], formatDayMonth(upcoming.on, t.dateTimeTag)),
      tone: daysOverdue > 0 ? 'warning' : 'neutral',
      daysOverdue,
    };
  }

  // Overdue, inside the window, and nothing will ever run — an empty scenario,
  // or every rung already sent.
  if (daysOverdue > 0) {
    return { label: t.workflow.nothingScheduled, tone: 'danger', daysOverdue };
  }

  // Not due yet, with nothing placed before the due date. The chase has not begun.
  return { label: t.workflow.notStarted, tone: 'neutral', daysOverdue };
}

export { shortLabelFor, stepLabels, stepShort } from './step-labels';
