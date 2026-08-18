import { describe, expect, it } from 'vitest';

import { settlementMethod } from './settlement';

const base = {
  status: 'paid' as const,
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  viva_transaction_id: null,
  paid_at: null,
  source: 'mydata' as const,
};

describe('settlementMethod', () => {
  it('is null for anything not paid', () => {
    expect(settlementMethod({ ...base, status: 'pending' })).toBeNull();
    expect(settlementMethod({ ...base, status: 'cancelled' })).toBeNull();
  });

  it('reads a Stripe id as a card payment through the link', () => {
    expect(
      settlementMethod({ ...base, stripe_checkout_session_id: 'cs_1', paid_at: '2026-08-14' }),
    ).toBe('card_stripe');
    // The webhook can settle before the session id lands; the intent alone is
    // just as much proof of the card flow.
    expect(settlementMethod({ ...base, stripe_payment_intent_id: 'pi_1' })).toBe('card_stripe');
  });

  it('reads a Viva transaction id as a card payment through the link', () => {
    expect(
      settlementMethod({ ...base, viva_transaction_id: 'vt_1', paid_at: '2026-08-14' }),
    ).toBe('card_viva');
  });

  it('labels a bank-matched settlement as a transfer', () => {
    expect(
      settlementMethod({ ...base, paid_at: '2026-08-14T10:00:00Z' }, { settledByBank: true }),
    ).toBe('transfer');
    // A provider reference outranks the bank flag: the card flow settled it
    // first and the transfer row went to review instead.
    expect(
      settlementMethod(
        { ...base, stripe_payment_intent_id: 'pi_1', paid_at: '2026-08-14T10:00:00Z' },
        { settledByBank: true },
      ),
    ).toBe('card_stripe');
  });

  it('reads a timestamp without any reference as an off-platform settlement', () => {
    expect(settlementMethod({ ...base, paid_at: '2026-08-14T10:00:00Z' })).toBe('external');
    // Marking an Elorus-sourced document paid by hand is still an off-platform
    // settlement — the tenant recorded it here, not in the billing system.
    expect(
      settlementMethod({ ...base, source: 'elorus', paid_at: '2026-08-14T10:00:00Z' }),
    ).toBe('external');
  });

  it('attributes a paid Elorus import with no local timestamp to the billing system', () => {
    expect(settlementMethod({ ...base, source: 'elorus' })).toBe('billing_system');
  });
});
