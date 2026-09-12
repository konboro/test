import { describe, expect, it } from 'vitest';

import {
  agingBuckets,
  collectedAmounts,
  collectedThroughLefta,
  failedSendsWorthFixing,
  funnelRows,
  funnelTotals,
  startedNotPaid,
  untaggedViews,
} from './figures';

const LABELS = { notDue: 'not due', late1to9: '1–9', late10plus: '10+' };

/** An invoice with only the fields these functions read. */
function invoice(over: Partial<Parameters<typeof collectedThroughLefta>[0][number]> = {}) {
  return {
    amount_cents: 10000,
    currency: 'EUR',
    status: 'paid',
    paid_at: '2026-09-01T10:00:00Z',
    paid_amount_cents: null,
    stripe_payment_intent_id: null,
    viva_transaction_id: null,
    revolut_order_id: null,
    ...over,
  };
}

describe('money collected through lefta', () => {
  it('counts only invoices carrying a provider reference', () => {
    // A document synced from myDATA and paid by transfer years ago is settled,
    // but this product did not collect it. Counting it made the tile read as
    // revenue lefta brought in.
    const rows = [
      invoice({ stripe_payment_intent_id: 'pi_1' }),
      invoice({ viva_transaction_id: 'viva_1' }),
      invoice({ revolut_order_id: 'rev_1' }),
      invoice(),
    ];

    expect(collectedThroughLefta(rows)).toHaveLength(3);
  });

  it('ignores an unpaid invoice even when a checkout was once created for it', () => {
    expect(
      collectedThroughLefta([invoice({ status: 'pending', stripe_payment_intent_id: 'pi_1' })]),
    ).toHaveLength(0);
  });

  it('reports what was captured, not what was invoiced', () => {
    // A part payment through the link settles less than the face value; the
    // tile has to say what actually arrived.
    expect(
      collectedAmounts([invoice({ amount_cents: 10000, paid_amount_cents: 4000 })]),
    ).toEqual([{ amount_cents: 4000, currency: 'EUR' }]);
  });

  it('falls back to the invoiced amount when nothing recorded the capture', () => {
    expect(collectedAmounts([invoice({ amount_cents: 10000 })])).toEqual([
      { amount_cents: 10000, currency: 'EUR' },
    ]);
  });
});

describe('the open balance split by age', () => {
  const rows = [
    { due_date: '2026-09-20', amount_cents: 100, currency: 'EUR' },
    { due_date: '2026-09-12', amount_cents: 200, currency: 'EUR' },
    { due_date: '2026-09-11', amount_cents: 400, currency: 'EUR' },
    { due_date: '2026-09-03', amount_cents: 800, currency: 'EUR' },
    { due_date: '2026-09-02', amount_cents: 1600, currency: 'EUR' },
  ];

  // Days late as the screens compute it: positive once the due date has passed.
  const daysLate = (row: { due_date: string }) =>
    Math.round(
      (Date.parse('2026-09-12T00:00:00Z') - Date.parse(`${row.due_date}T00:00:00Z`)) / 86400000,
    );

  it('puts the boundaries where the ladder puts them', () => {
    const [notDue, late, veryLate] = agingBuckets(rows, daysLate, LABELS);

    // Due today counts as current, day 1 opens the middle bucket, and day 10
    // is where the last automated step has already fired.
    expect(notDue).toMatchObject({ count: 2, cents: 300 });
    expect(late).toMatchObject({ count: 2, cents: 1200 });
    expect(veryLate).toMatchObject({ count: 1, cents: 1600 });
  });

  it('accounts for every invoice exactly once', () => {
    const buckets = agingBuckets(rows, daysLate, LABELS);

    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(rows.length);
    expect(buckets.reduce((sum, b) => sum + b.cents, 0)).toBe(3100);
  });

  it('returns all three buckets on an empty book rather than none', () => {
    // The strip renders its legend from this; a missing bucket would drop a
    // label rather than show a zero.
    expect(agingBuckets([], daysLate, LABELS).map((b) => b.count)).toEqual([0, 0, 0]);
  });
});

describe('the reminder funnel', () => {
  const comms = [
    { invoice_id: 'a', channel: 'email', sent_at: '2026-09-01T09:00:00Z' },
    // Same invoice, second reminder: engagement did not double.
    { invoice_id: 'a', channel: 'email', sent_at: '2026-09-05T09:00:00Z' },
    { invoice_id: 'a', channel: 'sms', sent_at: '2026-09-05T09:05:00Z' },
    { invoice_id: 'b', channel: 'sms', sent_at: '2026-09-02T09:00:00Z' },
    { invoice_id: null, channel: 'email', sent_at: '2026-09-02T09:00:00Z' },
  ];

  const events = [
    { invoice_id: 'a', channel: 'email', event: 'page_view' as const },
    { invoice_id: 'a', channel: 'email', event: 'page_view' as const },
    { invoice_id: 'a', channel: 'email', event: 'checkout_started' as const },
    { invoice_id: 'b', channel: 'other', event: 'page_view' as const },
  ];

  it('counts invoices per channel, not messages', () => {
    const [email, sms] = funnelRows(['email', 'sms'], comms, events, new Map());

    expect(email).toMatchObject({ sent: 1, opened: 1, checkout: 1 });
    expect(sms).toMatchObject({ sent: 2, opened: 0, checkout: 0 });
  });

  it('does not count one invoice twice in the overview strip', () => {
    // Invoice 'a' was reminded by both email and SMS. Per channel that is two
    // rows, which is right for comparing channels; adding the rows up would
    // report three invoices reminded where there are two.
    const totals = funnelTotals(comms, events, new Map());

    expect(totals.sent).toBe(2);
    expect(totals.opened).toBe(2);
    expect(totals.checkout).toBe(1);
  });

  it('attributes a payment made within the window to the reminder', () => {
    const paidAt = new Map([['a', Date.parse('2026-09-03T09:00:00Z')]]);

    expect(funnelTotals(comms, events, paidAt).paid).toBe(1);
  });

  it('does not attribute a payment made before the reminder went out', () => {
    const paidAt = new Map([['a', Date.parse('2026-08-20T09:00:00Z')]]);

    expect(funnelTotals(comms, events, paidAt).paid).toBe(0);
  });

  it('does not attribute a payment that landed long after', () => {
    // Eight days: outside the seven-day attribution window, so the reminder
    // gets no credit for it.
    const paidAt = new Map([['a', Date.parse('2026-09-09T10:00:00Z')]]);

    expect(funnelTotals(comms, events, paidAt).paid).toBe(0);
  });

  it('counts an untagged visit as a visit that cannot name its message', () => {
    expect(untaggedViews(events)).toBe(1);
  });
});

describe('the queue on the overview', () => {
  it('counts a started payment only while the invoice is still open', () => {
    const events = [
      { invoice_id: 'open', channel: 'email', event: 'checkout_started' as const },
      { invoice_id: 'open', channel: 'sms', event: 'checkout_started' as const },
      { invoice_id: 'settled', channel: 'email', event: 'checkout_started' as const },
      { invoice_id: 'open', channel: 'email', event: 'page_view' as const },
    ];

    // Two events on one invoice are one job, and a checkout abandoned before
    // the customer paid by transfer is not outstanding work.
    expect(startedNotPaid(events, new Set(['open']))).toBe(1);
  });

  it('counts a refused send only while the customer still owes the money', () => {
    const failures = [
      { invoice_id: 'open' },
      { invoice_id: 'open' },
      { invoice_id: 'settled' },
      // A send with no invoice behind it — a bulk message, say — cannot be
      // checked against the book, so it stays out of the count.
      { invoice_id: null },
    ];

    expect(failedSendsWorthFixing(failures, new Set(['open']))).toBe(2);
  });

  it('empties when nothing is open, so the card disappears', () => {
    expect(failedSendsWorthFixing([{ invoice_id: 'x' }], new Set())).toBe(0);
    expect(startedNotPaid([{ invoice_id: 'x', channel: null, event: 'checkout_started' }], new Set())).toBe(0);
  });
});
