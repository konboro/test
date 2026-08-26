import { describe, expect, it } from 'vitest';

import { bankHintsFor, type BankCandidate } from './bank-hint';

const tx = (over: Partial<BankCandidate>): BankCandidate => ({
  booked_on: '2026-09-04',
  amount_cents: 45500,
  counterparty_name: 'ΚΑΦΕ ΜΟΝΑΔΑ ΙΚΕ',
  state: 'unmatched',
  ...over,
});

describe('bankHintsFor', () => {
  it('finds the credit the claim describes', () => {
    const hints = bankHintsFor(
      { claimed_paid_on: '2026-09-03', claimed_amount_cents: 45500 },
      45500,
      [tx({})],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.amount_cents).toBe(45500);
  });

  it('tolerates a slightly misremembered amount, within 2%', () => {
    expect(
      bankHintsFor({ claimed_amount_cents: 45500 }, 45500, [tx({ amount_cents: 45000 })]),
    ).toHaveLength(1);
    expect(
      bankHintsFor({ claimed_amount_cents: 45500 }, 45500, [tx({ amount_cents: 40000 })]),
    ).toHaveLength(0);
  });

  it('falls back to the invoice amount when none was claimed', () => {
    expect(bankHintsFor({}, 45500, [tx({})])).toHaveLength(1);
  });

  it('rejects credits booked before the claim could have been sent', () => {
    // "Paid on the 10th" cannot be a credit from the 5th; one day of slack
    // covers a transfer sent late the previous evening.
    const claim = { claimed_paid_on: '2026-09-10' };
    expect(bankHintsFor(claim, 45500, [tx({ booked_on: '2026-09-05' })])).toHaveLength(0);
    expect(bankHintsFor(claim, 45500, [tx({ booked_on: '2026-09-09' })])).toHaveLength(1);
    expect(bankHintsFor(claim, 45500, [tx({ booked_on: '2026-09-12' })])).toHaveLength(1);
  });

  it('only corroborates with credits still looking for a home', () => {
    expect(bankHintsFor({}, 45500, [tx({ state: 'settled' })])).toHaveLength(0);
    expect(bankHintsFor({}, 45500, [tx({ state: 'dismissed' })])).toHaveLength(0);
    expect(bankHintsFor({}, 45500, [tx({ state: 'review' })])).toHaveLength(1);
  });

  it('caps at three, closest amount first', () => {
    const hints = bankHintsFor({ claimed_amount_cents: 45500 }, 45500, [
      tx({ amount_cents: 45000, booked_on: '2026-09-01' }),
      tx({ amount_cents: 45500, booked_on: '2026-09-02' }),
      tx({ amount_cents: 45400, booked_on: '2026-09-03' }),
      tx({ amount_cents: 45600, booked_on: '2026-09-04' }),
    ]);
    expect(hints).toHaveLength(3);
    expect(hints[0]?.amount_cents).toBe(45500);
  });
});
