/**
 * Turning a selection of invoices into the messages that will actually be sent.
 *
 * At most one message reaches a customer per day, so a selection of a hundred
 * and forty invoices belonging to ninety customers is ninety sends however it
 * is sliced. Deciding that up front is what lets one press finish the job
 * instead of reporting a remainder five times over.
 *
 * Pure, because it decides who is written to.
 */

export interface SelectedInvoice {
  id: string;
  debtor_id: string;
}

export interface BulkPlan {
  /** Invoices to send, one per customer. */
  work: string[];
  /** Selected invoices the daily rule would refuse: a repeat, or already sent to. */
  limited: number;
  /** Customers still owed a message after this press. Zero unless the cap bit. */
  left: number;
}

export function planBulkSend(
  rows: ReadonlyArray<SelectedInvoice>,
  contacted: ReadonlySet<string>,
  maxSends: number,
): BulkPlan {
  const work: string[] = [];
  const claimed = new Set<string>();
  let limited = 0;

  for (const row of rows) {
    // Already heard from us today, or a second invoice of a customer this batch
    // is already writing to. Counted rather than hidden: the daily rule is why
    // these are not sent, and saying so is the difference between a safeguard
    // and a silent gap.
    if (contacted.has(row.debtor_id) || claimed.has(row.debtor_id)) {
      limited += 1;
      continue;
    }

    claimed.add(row.debtor_id);
    work.push(row.id);
  }

  return {
    work: work.slice(0, maxSends),
    limited,
    left: Math.max(0, work.length - maxSends),
  };
}
