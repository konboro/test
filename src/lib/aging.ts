import type { Dictionary } from '@/lib/i18n/dictionaries';
import { daysBetween } from '@/lib/money';
import type { InvoiceRow } from '@/types/database';

export interface Aging {
  label: string;
  tone: 'neutral' | 'warning' | 'danger';
  /** Positive when overdue, negative when still to run. */
  days: number;
}

/**
 * How late an invoice is, or how long it still has.
 *
 * A due date on its own makes the reader do the arithmetic, and they do it
 * wrongly at a glance: "31/07" and "02/08" look equally urgent in a list until
 * you notice today's date. The count is the thing being decided on, so it is
 * shown directly.
 *
 * Only pending invoices have an age. A paid or cancelled one is not late, it is
 * finished, and colouring it red for having been due last month would be noise.
 *
 * The ten-day threshold matches the ladder's final step: past it, the automated
 * escalation has nothing further to send, so the row is genuinely the operator's
 * problem rather than the system's.
 */
export function aging(
  invoice: Pick<InvoiceRow, 'status' | 'due_date'>,
  today: string,
  t: Dictionary,
): Aging | null {
  if (invoice.status !== 'pending') return null;

  const days = daysBetween(invoice.due_date, today);

  if (days > 0) {
    return { label: t.invoices.overdueBy(days), tone: days >= 10 ? 'danger' : 'warning', days };
  }
  if (days === 0) return { label: t.invoices.dueToday, tone: 'warning', days };

  return { label: t.invoices.dueIn(-days), tone: 'neutral', days };
}
