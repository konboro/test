import { describe, expect, it } from 'vitest';

import { mapCredits, toCredit, transactionSignature } from './client';

/**
 * Eurobank returns every row with `entry_reference` and `transaction_id` empty.
 * Ingest keys on that id, so without a substitute the entire statement is
 * discarded — which is exactly what happened: 19 movements fetched, 0 kept.
 *
 * These cover the substitute, and the property everything else depends on: the
 * same statement read twice must produce the same ids, or the seven-day overlap
 * re-ingests the lot every morning.
 */

const credit = (over: Record<string, unknown> = {}) => ({
  transaction_amount: { amount: '120.00', currency: 'EUR' },
  credit_debit_indicator: 'CRDT',
  booking_date: '2026-08-14',
  debtor: { name: 'ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ' },
  debtor_account: { iban: 'GR1601101250000000012300695' },
  remittance_information: ['ΑΠΥ-Β-41'],
  ...over,
});

describe('substitute transaction id', () => {
  it('maps a credit the bank did not identify', () => {
    // The whole bug in one assertion: this used to return null.
    expect(toCredit(credit(), 'derived:abc:0')?.providerTxId).toBe('derived:abc:0');
  });

  it('prefers the bank’s own id when there is one', () => {
    expect(toCredit(credit({ entry_reference: 'EB-1' }), 'derived:abc:0')?.providerTxId).toBe('EB-1');
    expect(toCredit(credit({ transaction_id: 'TX-9' }), 'derived:abc:0')?.providerTxId).toBe('TX-9');
  });

  it('treats a blank id as no id', () => {
    // Some banks send the key with an empty string rather than omitting it.
    expect(toCredit(credit({ entry_reference: '   ' }), 'derived:abc:0')?.providerTxId).toBe(
      'derived:abc:0',
    );
  });

  it('still refuses a row with no amount or date, id or not', () => {
    expect(toCredit(credit({ transaction_amount: undefined }), 'derived:abc:0')).toBeNull();
    expect(toCredit(credit({ booking_date: undefined, value_date: undefined }), 'x')).toBeNull();
  });
});

describe('signature stability', () => {
  it('is identical for the same movement read twice', () => {
    expect(transactionSignature(credit())).toBe(transactionSignature(credit()));
  });

  it('differs when anything about the movement differs', () => {
    const base = transactionSignature(credit());

    expect(transactionSignature(credit({ transaction_amount: { amount: '120.01', currency: 'EUR' } }))).not.toBe(base);
    expect(transactionSignature(credit({ booking_date: '2026-08-15' }))).not.toBe(base);
    expect(transactionSignature(credit({ debtor: { name: 'ΑΛΛΟΣ ΑΕ' } }))).not.toBe(base);
    expect(transactionSignature(credit({ remittance_information: ['ΑΠΥ-Β-42'] }))).not.toBe(base);
  });
});

describe('mapping a whole statement', () => {
  it('re-reading the same statement yields the same ids', () => {
    // This is what makes the seven-day overlap safe. Without it every morning
    // would ingest the same week again as new money.
    const statement = [credit(), credit({ booking_date: '2026-08-15' })];

    expect(mapCredits(statement).map((c) => c.providerTxId)).toEqual(
      mapCredits(statement).map((c) => c.providerTxId),
    );
  });

  it('keeps two genuinely identical payments apart', () => {
    // Same day, same amount, same payer, same reference — legitimately two
    // payments. Collapsing them would lose one.
    const ids = mapCredits([credit(), credit()]).map((c) => c.providerTxId);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('drops debits but lets them keep their place', () => {
    // A debit sitting between two identical credits must still consume its
    // occurrence, or removing it later renumbers everything after it and the
    // whole tail re-ingests as new.
    const withDebit = mapCredits([
      credit(),
      credit({ credit_debit_indicator: 'DBIT' }),
      credit({ booking_date: '2026-08-16' }),
    ]);

    expect(withDebit).toHaveLength(2);
    expect(withDebit[1]?.providerTxId).toBe(
      mapCredits([
        credit(),
        credit({ credit_debit_indicator: 'DBIT' }),
        credit({ booking_date: '2026-08-16' }),
      ])[1]?.providerTxId,
    );
  });

  it('reads the counterparty account under either spelling', () => {
    expect(mapCredits([credit()])[0]?.counterpartyIban).toBe('GR1601101250000000012300695');
    expect(
      mapCredits([credit({ debtor_account: { identification: 'GR99' } })])[0]?.counterpartyIban,
    ).toBe('GR99');
  });
});
