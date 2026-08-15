import { athensDate, daysBetween } from '@/lib/money';
import type { DunningStep, InvoiceRow } from '@/types/database';

import { LADDER, stepForInvoice } from './engine';

export const STEP_LABELS: Record<DunningStep, string> = {
  pre_due: '1 — Υπενθύμιση πριν τη λήξη',
  overdue_2: '2 — Ληξιπρόθεσμο (email + SMS)',
  overdue_10: '3 — Τελική υπενθύμιση (email + SMS)',
};

export const STEP_SHORT: Record<DunningStep, string> = {
  pre_due: 'Βήμα 1',
  overdue_2: 'Βήμα 2',
  overdue_10: 'Βήμα 3',
};

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
 */
export function workflowStatus(
  invoice: Pick<InvoiceRow, 'status' | 'due_date'>,
  completedSteps: ReadonlySet<DunningStep>,
  today: string = athensDate(),
): WorkflowStatus {
  const daysOverdue = daysBetween(invoice.due_date, today);

  if (invoice.status === 'paid') return { label: 'Εξοφλήθηκε', tone: 'positive', daysOverdue };
  if (invoice.status === 'cancelled') return { label: 'Ακυρώθηκε', tone: 'neutral', daysOverdue };
  if (invoice.status === 'written_off') return { label: 'Διαγράφηκε', tone: 'neutral', daysOverdue };

  const lastDone = [...LADDER].reverse().find((rung) => completedSteps.has(rung.step));

  if (lastDone) {
    const isFinal = lastDone.step === 'overdue_10';
    return {
      label: `${STEP_SHORT[lastDone.step]} στάλθηκε${isFinal ? ' (τελικό)' : ''}`,
      tone: isFinal ? 'danger' : 'warning',
      daysOverdue,
    };
  }

  const pending = stepForInvoice(invoice.due_date, today);
  if (pending) {
    return {
      label: `${STEP_SHORT[pending.step]} σε αναμονή`,
      tone: pending.step === 'pre_due' ? 'info' : 'warning',
      daysOverdue,
    };
  }

  if (daysOverdue > 0) {
    return { label: `${daysOverdue} ημέρες σε καθυστέρηση`, tone: 'danger', daysOverdue };
  }

  return { label: `Λήγει σε ${Math.abs(daysOverdue)} ημέρες`, tone: 'neutral', daysOverdue };
}
