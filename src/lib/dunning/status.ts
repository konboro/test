import { DICTIONARIES, type Dictionary } from '@/lib/i18n/dictionaries';
import { athensDate, daysBetween } from '@/lib/money';
import type { DunningStep, InvoiceRow } from '@/types/database';

import { stepForInvoice } from './engine';
import { stepShort } from './step-labels';
import {
  ABANDON_AFTER_DAYS,
  activeSteps,
  DEFAULT_SCENARIO,
  LADDER_STEPS,
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

  const pending = stepForInvoice(invoice.due_date, today, scenario);
  if (pending) {
    return {
      label: t.workflow.stepPending(short[pending.step]),
      tone: pending.step === 'pre_due' ? 'info' : 'warning',
      daysOverdue,
    };
  }

  // Nothing on the ladder applies to this invoice. These two branches used to
  // answer with the number of days late — which is the aging column, one cell to
  // the left, saying the same thing in different words. This column's subject is
  // what the chase is doing, so when it is doing nothing it says why.
  //
  // Three reasons, and they are not the same news. Past the abandon threshold
  // the automation will never touch the invoice again, and that is the state
  // worth naming: it is how a book quietly fills with debts nobody is chasing.
  if (daysOverdue > ABANDON_AFTER_DAYS) {
    return { label: t.workflow.abandoned, tone: 'danger', daysOverdue };
  }

  // Overdue and inside the window, but no step covers today — an empty scenario,
  // or a gap between the rungs the tenant placed.
  if (daysOverdue > 0) {
    return { label: t.workflow.nothingScheduled, tone: 'danger', daysOverdue };
  }

  // Not due yet, with no pre-due step to run. The chase has not begun.
  return { label: t.workflow.notStarted, tone: 'neutral', daysOverdue };
}

export { shortLabelFor, stepLabels, stepShort } from './step-labels';
