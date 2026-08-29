import { describe, expect, it } from 'vitest';

import { settlementFor, type CheckoutState } from './reconcile';

/**
 * The rule that decides whether a checkout closes an invoice.
 *
 * Worth pinning down precisely: settling wrongly forgives money that was never
 * collected, and refusing wrongly keeps chasing somebody who has already paid.
 * Both are the kind of mistake a customer notices before we do.
 */

const invoice = { id: 'inv-1', amount_cents: 45500 };

const paid = (capturedCents: number | null, reference: string | null = 'pi_1'): CheckoutState => ({
  kind: 'paid',
  capturedCents,
  reference,
});

describe('settlementFor', () => {
  it('settles a checkout that covered the invoice', () => {
    expect(settlementFor(invoice, paid(45500))).toEqual({
      action: 'settle',
      paidCents: 45500,
      reference: 'pi_1',
    });
  });

  it('leaves an unpaid checkout alone', () => {
    expect(settlementFor(invoice, { kind: 'open' })).toEqual({ action: 'skip', reason: 'open' });
  });

  it('never settles a checkout belonging to another invoice', () => {
    // The binding is metadata we wrote ourselves. A session id lifted from
    // somewhere else is genuinely paid and still settles nothing here.
    expect(settlementFor(invoice, { kind: 'mismatch' })).toEqual({
      action: 'skip',
      reason: 'mismatch',
    });
  });

  it('refuses to close an invoice for less than it asks', () => {
    // The invoice was corrected upwards while the checkout sat open. Closing it
    // in full would forgive the difference and stop the chasing for it.
    expect(settlementFor(invoice, paid(20000))).toEqual({
      action: 'skip',
      reason: 'under-capture',
    });
  });

  it('settles an over-capture for what was actually taken', () => {
    // Corrected downwards instead. The debt is covered, and the record should
    // say what left the customer's account, not what we asked for.
    expect(settlementFor(invoice, paid(50000))).toEqual({
      action: 'settle',
      paidCents: 50000,
      reference: 'pi_1',
    });
  });

  it('trusts the invoice amount when the provider will not say', () => {
    // The order was created from the database with this figure and a provider
    // can only charge what it was asked for, so a missing total is not a reason
    // to leave a paid invoice open.
    expect(settlementFor(invoice, paid(null))).toEqual({
      action: 'settle',
      paidCents: 45500,
      reference: 'pi_1',
    });
  });

  it('settles without a reference rather than not at all', () => {
    // The payment intent is bookkeeping. Money moved either way, and an invoice
    // left open because a provider omitted an id is a customer chased for it.
    expect(settlementFor(invoice, paid(45500, null))).toEqual({
      action: 'settle',
      paidCents: 45500,
      reference: null,
    });
  });

  it('treats one cent short as short', () => {
    expect(settlementFor(invoice, paid(45499)).action).toBe('skip');
    expect(settlementFor(invoice, paid(45500)).action).toBe('settle');
  });

  it('settles a zero-amount invoice that captured nothing', () => {
    // Degenerate, but it must not be classed as an under-capture and left to
    // be chased for nothing.
    expect(settlementFor({ id: 'inv-0', amount_cents: 0 }, paid(0))).toEqual({
      action: 'settle',
      paidCents: 0,
      reference: 'pi_1',
    });
  });
});
