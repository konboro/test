import { describe, expect, it } from 'vitest';

import { matchCredit, signalsFor, type BankCredit, type InvoiceCandidate } from './match';
import { ibanMatches, namesAgree, referenceMatches } from './normalise';

const CREDIT: BankCredit = {
  amountCents: 124000,
  currency: 'EUR',
  bookedOn: '2026-07-15',
  remittance: null,
  counterpartyName: null,
  counterpartyIban: null,
};

const INVOICE: InvoiceCandidate = {
  invoiceId: 'inv-1',
  amountCents: 124000,
  currency: 'EUR',
  issueDate: '2026-07-01',
  invoiceNumber: '1042',
  series: 'ΤΠΥ',
  mark: '400001912345678',
  debtorName: 'Παπαδόπουλος Γεώργιος',
  debtorIbans: ['GR16 0110 1250 0000 0001 2300 695'],
};

describe('name folding', () => {
  it('reconciles a Greek name with the transliteration a bank sends', () => {
    // Neither spelling is canonical; both are folded until they agree.
    expect(namesAgree('Παπαδόπουλος Γεώργιος', 'PAPADOPOULOS GEORGIOS')).toBe(true);
    expect(namesAgree('Παπαδόπουλος Γεώργιος', 'PAPADOPULOS G')).toBe(true);
  });

  it('survives the spellings Greek letters have no single Latin form for', () => {
    expect(namesAgree('Χρήστος Οικονόμου', 'CHRISTOS OIKONOMOU')).toBe(true);
    expect(namesAgree('Χρήστος Οικονόμου', 'HRISTOS OIKONOMOU')).toBe(true);
    expect(namesAgree('Χρήστος Οικονόμου', 'XRISTOS OIKONOMOU')).toBe(true);
    expect(namesAgree('Βασίλης Δήμου', 'VASILIS DIMOU')).toBe(true);
    expect(namesAgree('Βασίλης Δήμου', 'BASILIS DIMOU')).toBe(true);
    // ΜΠ is how Greek writes a b; the bank writes the b back.
    expect(namesAgree('Μπάμπης Λάμπρου', 'BABIS LABROU')).toBe(true);
  });

  it('ignores word order, since banks put the surname wherever they like', () => {
    expect(namesAgree('Γεώργιος Παπαδόπουλος', 'PAPADOPOULOS GEORGIOS')).toBe(true);
  });

  it('does not let a legal form pass as a name', () => {
    // Every Greek company carries one, so `AE` matching `AE` would match everyone.
    expect(namesAgree('Alpha AE', 'BETA AE')).toBe(false);
    expect(namesAgree('Alpha IKE', 'GAMMA IKE')).toBe(false);
  });

  it('refuses to match on nothing', () => {
    expect(namesAgree(null, 'PAPADOPOULOS')).toBe(false);
    expect(namesAgree('Παπαδόπουλος', null)).toBe(false);
    expect(namesAgree('ΑΕ', 'AE')).toBe(false);
  });
});

describe('reference in the remittance', () => {
  const doc = { invoiceNumber: '1042', series: 'ΤΠΥ', mark: '400001912345678' };

  it('finds the document number however the payer typed it', () => {
    expect(referenceMatches('ΤΠΥ 1042', doc)).toBe(true);
    expect(referenceMatches('1042', doc)).toBe(true);
    expect(referenceMatches('EXOFLISI TIM. 0001042', doc)).toBe(true);
    expect(referenceMatches('invoice #1042 payment', doc)).toBe(true);
  });

  it('finds the MARK, still as a string', () => {
    // 15 digits: as a number it would lose its tail.
    expect(referenceMatches('MARK 400001912345678', doc)).toBe(true);
    expect(referenceMatches('MARK 400001912345679', doc)).toBe(false);
  });

  it('will not take a number out of the middle of another one', () => {
    // The old flattening approach matched `1042` inside a date or an amount.
    expect(referenceMatches('20261042000', doc)).toBe(false);
    expect(referenceMatches('order 51042', doc)).toBe(false);
  });

  it('ignores references too short to be evidence', () => {
    expect(referenceMatches('42', { invoiceNumber: '42', series: null, mark: null })).toBe(false);
  });

  it('handles an empty remittance', () => {
    expect(referenceMatches(null, doc)).toBe(false);
    expect(referenceMatches('   ', doc)).toBe(false);
  });
});

describe('iban', () => {
  it('ignores the spacing each bank chooses', () => {
    expect(ibanMatches('GR1601101250000000012300695', ['GR16 0110 1250 0000 0001 2300 695'])).toBe(
      true,
    );
    expect(ibanMatches('gr16 0110 1250 0000 0001 2300 695', ['GR1601101250000000012300695'])).toBe(
      true,
    );
  });

  it('does not match an unknown account', () => {
    expect(ibanMatches('GR9999999999999999999999999', ['GR1601101250000000012300695'])).toBe(false);
    expect(ibanMatches(null, ['GR1601101250000000012300695'])).toBe(false);
  });
});

describe('matchCredit', () => {
  it('settles on the amount plus a reference', () => {
    const result = matchCredit({ ...CREDIT, remittance: 'EXOFLISI 1042' }, [INVOICE]);
    expect(result).toEqual({ kind: 'settle', invoiceId: 'inv-1', signals: ['reference'] });
  });

  it('settles on the amount plus a name', () => {
    const result = matchCredit({ ...CREDIT, counterpartyName: 'PAPADOPOULOS GEORGIOS' }, [INVOICE]);
    expect(result).toEqual({ kind: 'settle', invoiceId: 'inv-1', signals: ['name'] });
  });

  it('settles on the amount plus a known account', () => {
    const result = matchCredit(
      { ...CREDIT, counterpartyIban: 'GR1601101250000000012300695' },
      [INVOICE],
    );
    expect(result).toEqual({ kind: 'settle', invoiceId: 'inv-1', signals: ['iban'] });
  });

  it('records every signal that fired, not just the first', () => {
    const result = matchCredit(
      { ...CREDIT, remittance: '1042', counterpartyName: 'PAPADOPOULOS' },
      [INVOICE],
    );
    expect(result).toMatchObject({ kind: 'settle', signals: ['reference', 'name'] });
  });

  it('sends an amount with nothing behind it to review', () => {
    expect(matchCredit(CREDIT, [INVOICE])).toEqual({
      kind: 'review',
      reason: 'amount-only',
      invoiceIds: ['inv-1'],
    });
  });

  it('refuses to choose between two invoices the evidence fits equally', () => {
    // Same debtor, same amount, one payment. No signal can say which document it
    // was for, so settling either would be a guess dressed up as a match.
    const twin: InvoiceCandidate = { ...INVOICE, invoiceId: 'inv-2', invoiceNumber: '1043' };
    const result = matchCredit({ ...CREDIT, counterpartyName: 'PAPADOPOULOS' }, [INVOICE, twin]);

    expect(result).toEqual({
      kind: 'review',
      reason: 'ambiguous',
      invoiceIds: ['inv-1', 'inv-2'],
    });
  });

  it('still settles when only one of the twins is corroborated', () => {
    const twin: InvoiceCandidate = {
      ...INVOICE,
      invoiceId: 'inv-2',
      invoiceNumber: '1043',
      debtorName: 'Άλλος Πελάτης',
      debtorIbans: [],
    };
    const result = matchCredit({ ...CREDIT, remittance: 'TIM 1043' }, [INVOICE, twin]);

    expect(result).toMatchObject({ kind: 'settle', invoiceId: 'inv-2' });
  });

  it('needs the amount to be exact', () => {
    expect(matchCredit({ ...CREDIT, amountCents: 123999, remittance: '1042' }, [INVOICE])).toEqual({
      kind: 'unmatched',
    });
  });

  it('will not cross currencies', () => {
    expect(matchCredit({ ...CREDIT, currency: 'USD', remittance: '1042' }, [INVOICE])).toEqual({
      kind: 'unmatched',
    });
  });

  it('will not pay an invoice that did not exist yet', () => {
    expect(matchCredit({ ...CREDIT, bookedOn: '2026-06-30', remittance: '1042' }, [INVOICE])).toEqual(
      { kind: 'unmatched' },
    );
  });

  it('ignores outgoing money', () => {
    expect(matchCredit({ ...CREDIT, amountCents: -124000 }, [INVOICE])).toEqual({
      kind: 'unmatched',
    });
  });

  it('handles a tenant with nothing open', () => {
    expect(matchCredit(CREDIT, [])).toEqual({ kind: 'unmatched' });
  });
});

describe('signalsFor', () => {
  it('reports no evidence rather than guessing', () => {
    expect(signalsFor(CREDIT, INVOICE)).toEqual([]);
  });
});
