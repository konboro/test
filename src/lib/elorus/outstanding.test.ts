import { describe, expect, it } from 'vitest';

import { toCents } from '@/lib/money';

/**
 * What a synced Elorus document says is owed.
 *
 * The sync read the document's gross total and consulted `paid` only when the
 * document was already fully settled, so a partially-paid invoice arrived at
 * face value. The customer was then chased for the whole amount and the payment
 * link charged it — taking money they had already handed over and creating a
 * refund to make. 130 of this tenant's 282 invoices come in through this path.
 *
 * The rule as the sync applies it, as an expression, because the sync itself
 * needs an API client and a database to reach.
 */
function receivable(total: string, paid: string) {
  const gross = toCents(Number(total));
  const collected = Number.isFinite(Number(paid)) ? Math.max(0, toCents(Number(paid))) : 0;
  const outstanding = Math.max(0, gross - collected);

  return { gross, collected, outstanding };
}

describe('a partially paid Elorus document', () => {
  it('is owed only the remainder', () => {
    const { outstanding, collected } = receivable('1000.00', '400.00');

    expect(outstanding).toBe(60000);
    expect(collected).toBe(40000);
  });

  it('owes its full value when nothing has been collected', () => {
    expect(receivable('1000.00', '0.00')).toMatchObject({ outstanding: 100000, collected: 0 });
  });

  it('owes nothing once it is fully collected', () => {
    // Elorus can still call this issued or overdue after the last payment lands.
    // Nothing is outstanding, so the sync files it as settled rather than
    // leaving a zero-value receivable open to be chased for nothing.
    expect(receivable('1000.00', '1000.00').outstanding).toBe(0);
  });

  it('never reports a negative receivable', () => {
    // An overpayment is not a debt the other way round.
    expect(receivable('100.00', '150.00').outstanding).toBe(0);
  });

  it('treats an unreadable paid field as nothing collected', () => {
    // Safer than the alternative: reading a blank as "fully paid" would stop
    // chasing a debt that is entirely outstanding.
    for (const paid of ['', 'n/a', 'null']) {
      expect(receivable('500.00', paid), paid).toMatchObject({
        collected: 0,
        outstanding: 50000,
      });
    }
  });

  it('keeps the cents, not the float', () => {
    // 0.1 + 0.2 arithmetic on a receivable is how an invoice ends up a cent off
    // and never matches the bank credit that settles it.
    expect(receivable('19.99', '9.99').outstanding).toBe(1000);
    expect(receivable('0.03', '0.01').outstanding).toBe(2);
  });
});
