import type { CommChannel, DunningStep } from '@/types/database';

/**
 * The arithmetic behind the overview and the statistics screen.
 *
 * Both screens report on the same book — one as a single figure and a 6px bar,
 * the other in full — and the two used to be one page, so the sums lived inside
 * its component. Splitting the page without splitting the sums out first is how
 * two screens come to disagree about how much a company is owed.
 *
 * Everything here is pure and takes its labels as arguments, so it can be tested
 * without a database or a dictionary.
 */

/** How far back reminder and link activity is counted. */
export const FUNNEL_DAYS = 30;

/** An invoice counts as converted when it settles this soon after a contact. */
export const ATTRIBUTION_DAYS = 7;

/** The start of the funnel window, as an ISO timestamp for a `gte` filter. */
export function funnelSince(now: number = Date.now()): string {
  return new Date(now - FUNNEL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

interface Receivable {
  amount_cents: number;
  /** Non-null in the schema, and `totalsByCurrency` wants it that way. */
  currency: string;
}

interface Settleable extends Receivable {
  status: string;
  paid_at?: string | null;
  paid_amount_cents?: number | null;
  stripe_payment_intent_id?: string | null;
  viva_transaction_id?: string | null;
  revolut_order_id?: string | null;
}

/**
 * The invoices whose money actually arrived through lefta.
 *
 * Every paid invoice used to count, which made the tile a total of everything
 * ever marked settled — including documents synced from myDATA and Elorus that
 * were paid long before this product touched them, and anything ticked off by
 * hand. It read as revenue this tool collected, and it was not.
 *
 * A provider reference is what distinguishes the two: it exists only when the
 * debtor paid through a link this system issued.
 */
export function collectedThroughLefta<T extends Settleable>(invoices: readonly T[]): T[] {
  return invoices.filter(
    (invoice) =>
      invoice.status === 'paid' &&
      (invoice.stripe_payment_intent_id != null ||
        invoice.viva_transaction_id != null ||
        invoice.revolut_order_id != null),
  );
}

/** What was captured, in the currency it was captured in. */
export function collectedAmounts(invoices: readonly Settleable[]): Receivable[] {
  return invoices.map((invoice) => ({
    amount_cents: invoice.paid_amount_cents ?? invoice.amount_cents,
    currency: invoice.currency,
  }));
}

export interface AgingBucket {
  key: 'notDue' | 'late1to9' | 'late10plus';
  label: string;
  swatch: string;
  count: number;
  cents: number;
}

interface Dated extends Receivable {
  due_date: string;
}

/**
 * The open balance split by how late it is.
 *
 * The thresholds mirror the ladder: at 1–9 days overdue the automated steps are
 * still doing the chasing; from day 10 the final reminder has fired and the
 * money is the operator's problem.
 *
 * `daysLate` is injected rather than computed here so the caller's own notion of
 * today — Athens, not the server's timezone — stays the only one in play.
 */
export function agingBuckets<T extends Dated>(
  invoices: readonly T[],
  daysLate: (invoice: T) => number,
  labels: { notDue: string; late1to9: string; late10plus: string },
): AgingBucket[] {
  const shape = [
    { key: 'notDue', label: labels.notDue, swatch: 'bg-brand-500', match: (d: number) => d <= 0 },
    {
      key: 'late1to9',
      label: labels.late1to9,
      swatch: 'bg-amber-500',
      match: (d: number) => d >= 1 && d <= 9,
    },
    {
      key: 'late10plus',
      label: labels.late10plus,
      swatch: 'bg-red-500',
      match: (d: number) => d >= 10,
    },
  ] as const;

  return shape.map((bucket) => {
    const own = invoices.filter((invoice) => bucket.match(daysLate(invoice)));
    return {
      key: bucket.key,
      label: bucket.label,
      swatch: bucket.swatch,
      count: own.length,
      cents: own.reduce((sum, invoice) => sum + invoice.amount_cents, 0),
    };
  });
}

export interface FunnelRow {
  channel: CommChannel;
  sent: number;
  opened: number;
  checkout: number;
  paid: number;
}

interface SentContact {
  invoice_id: string | null;
  channel: string;
  sent_at: string;
}

interface LinkEvent {
  invoice_id: string;
  channel: string | null;
  event: 'page_view' | 'checkout_started';
  occurred_at?: string;
}

/**
 * The reminder funnel, per channel, over the window.
 *
 * Every count is distinct invoices — a refreshed page or a resent message is not
 * engagement growth. "Paid" is an invoice settled within ATTRIBUTION_DAYS of a
 * sent contact on that channel; a debtor who reads the SMS and pays by transfer
 * never clicks anything, which is why payment timing is counted per channel
 * rather than clicks alone (docs/funnel-analytics.md).
 */
export function funnelRows(
  channels: readonly CommChannel[],
  comms: readonly SentContact[],
  events: readonly LinkEvent[],
  paidAtByInvoice: ReadonlyMap<string, number>,
): FunnelRow[] {
  const attributionMs = ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;

  return channels.map((channel) => {
    const firstSent = new Map<string, number>();
    for (const comm of comms) {
      if (comm.channel !== channel || !comm.invoice_id) continue;
      const at = new Date(comm.sent_at).getTime();
      const earliest = firstSent.get(comm.invoice_id);
      if (earliest === undefined || at < earliest) firstSent.set(comm.invoice_id, at);
    }

    const opened = new Set<string>();
    const checkout = new Set<string>();
    for (const event of events) {
      if (event.channel !== channel) continue;
      if (event.event === 'page_view') opened.add(event.invoice_id);
      if (event.event === 'checkout_started') checkout.add(event.invoice_id);
    }

    let paid = 0;
    for (const [invoiceId, sentAt] of firstSent) {
      const paidAt = paidAtByInvoice.get(invoiceId);
      if (paidAt !== undefined && paidAt >= sentAt && paidAt <= sentAt + attributionMs) paid += 1;
    }

    return { channel, sent: firstSent.size, opened: opened.size, checkout: checkout.size, paid };
  });
}

/**
 * The funnel as one line, for the strip on the overview.
 *
 * Summed across channels rather than averaged: the question the strip answers is
 * how the chasing is going in total, and an invoice reminded on both channels is
 * counted once per channel in `funnelRows` — which is right for comparing
 * channels and would be double counting here. So `sent` and the rest are
 * recounted over distinct invoices instead of added up.
 */
export function funnelTotals(
  comms: readonly SentContact[],
  events: readonly LinkEvent[],
  paidAtByInvoice: ReadonlyMap<string, number>,
): Omit<FunnelRow, 'channel'> {
  const attributionMs = ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;

  const firstSent = new Map<string, number>();
  for (const comm of comms) {
    if (!comm.invoice_id) continue;
    const at = new Date(comm.sent_at).getTime();
    const earliest = firstSent.get(comm.invoice_id);
    if (earliest === undefined || at < earliest) firstSent.set(comm.invoice_id, at);
  }

  const opened = new Set<string>();
  const checkout = new Set<string>();
  for (const event of events) {
    if (event.event === 'page_view') opened.add(event.invoice_id);
    if (event.event === 'checkout_started') checkout.add(event.invoice_id);
  }

  let paid = 0;
  for (const [invoiceId, sentAt] of firstSent) {
    const paidAt = paidAtByInvoice.get(invoiceId);
    if (paidAt !== undefined && paidAt >= sentAt && paidAt <= sentAt + attributionMs) paid += 1;
  }

  return { sent: firstSent.size, opened: opened.size, checkout: checkout.size, paid };
}

/** Link visits that carried no channel tag — a typed or forwarded link. */
export function untaggedViews(events: readonly LinkEvent[]): number {
  return new Set(
    events
      .filter((event) => event.event === 'page_view' && event.channel === 'other')
      .map((event) => event.invoice_id),
  ).size;
}

/**
 * Invoices where someone reached the payment step and no money followed.
 *
 * The one part of the funnel that is a job rather than a measurement, which is
 * why it belongs in the queue on the overview: the customer decided to pay, the
 * charge never completed, and nobody is chasing that on either side.
 *
 * Still-open invoices only. A checkout abandoned on Monday and settled by
 * transfer on Tuesday is not outstanding work.
 */
export function startedNotPaid(
  events: readonly LinkEvent[],
  stillOpen: ReadonlySet<string>,
): number {
  const started = new Set<string>();
  for (const event of events) {
    if (event.event === 'checkout_started' && stillOpen.has(event.invoice_id)) {
      started.add(event.invoice_id);
    }
  }
  return started.size;
}

/**
 * Failed sends that still matter.
 *
 * A send that the provider refused means a customer was never told they owe
 * anything — but only while they still owe it. Counting every failure ever
 * recorded would put a permanent number on the overview, most of it about
 * invoices settled months ago, and a queue that cannot be emptied is one people
 * stop reading.
 */
export function failedSendsWorthFixing(
  failures: readonly { invoice_id: string | null }[],
  stillOpen: ReadonlySet<string>,
): number {
  return failures.filter((row) => row.invoice_id && stillOpen.has(row.invoice_id)).length;
}

/** Steps already fired per invoice; manual contacts carry no step and are skipped. */
export function stepsByInvoice(
  contacts: readonly { invoice_id: string; step: DunningStep | null }[],
): Map<string, Set<DunningStep>> {
  const byInvoice = new Map<string, Set<DunningStep>>();
  for (const contact of contacts) {
    if (!contact.step) continue;
    const set = byInvoice.get(contact.invoice_id) ?? new Set<DunningStep>();
    set.add(contact.step);
    byInvoice.set(contact.invoice_id, set);
  }
  return byInvoice;
}
