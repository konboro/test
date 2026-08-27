import { DICTIONARIES, type Dictionary } from '@/lib/i18n/dictionaries';
import { athensDate, daysBetween } from '@/lib/money';
import type { DunningStep, InvoiceRow } from '@/types/database';

import { stepForInvoice } from './engine';
import { stepShort } from './step-labels';
import { activeSteps, DEFAULT_SCENARIO, LADDER_STEPS, type Scenario } from './scenario';

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

  if (daysOverdue > 0) {
    return { label: t.workflow.daysOverdue(daysOverdue), tone: 'danger', daysOverdue };
  }

  return { label: t.workflow.dueInDays(Math.abs(daysOverdue)), tone: 'neutral', daysOverdue };
}

export { shortLabelFor, stepLabels, stepShort } from './step-labels';
