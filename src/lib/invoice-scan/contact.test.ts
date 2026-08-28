import { describe, expect, it } from 'vitest';

import { extractInvoiceFields } from './fields';

/**
 * The real receipt this came from, with the customer's number changed.
 *
 * Everything else on it read correctly; only the contact details did not,
 * because the reader had no fields for them. The phone is what makes an SMS
 * reminder possible at all, so a document carrying one should not leave
 * somebody typing it back in.
 */
const RECEIPT = [
  'ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ #ΑΠΥ-Β-43',
  'ΗΜΕΡΟΜΗΝΙΑ: 25 Αύγ 2026, 12:21',
  'ΕΞΟΦΛΗΣΗ ΕΩΣ: 25 Αύγ 2026',
  'ΑΠΟ    ΠΕΛΑΤΗΣ',
  'Penny IKE    ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ',
  "ΑΦΜ: 802160515, ΔΟΥ: Δ' Θεσσαλονίκης    ΑΦΜ: 035371947",
  'ΑΜΜΟΧΩΣΤΟΥ 5, ΘΕΣΣΑΛΟΝΙΚΗ 54454, Ελλάδα    ΠΡΑΣΣΑΚΑΚΗ 45, ΘΕΣΣΑΛΟΝΙΚΗ 55535, Ελλάδα',
  'Πληροφορίες επικοινωνίας',
  'Ιδιώτης ΦΠΑ',
  'Τηλ: +30 6900000001',
  'Τελική αξία:    50,00€',
  'ΜΑΡΚ: 400014986629813, UID: 5C3E1B20351A6173F3E46E28E1DB144CB9A771F0',
  'EUROBANK IBAN GR4902600240000110201244724',
].join('\n');

describe('the contact details on a receipt', () => {
  it('reads the phone the document lists', () => {
    const { fields } = extractInvoiceFields(RECEIPT, { ownVatNumber: '802160515' });
    expect(fields.phone).toBe('+30 6900000001');
  });

  it('does not mistake an IBAN, a MARK or a tax number for a phone', () => {
    // Every one of those is a long run of digits sitting on this page. The
    // label is what keeps them out.
    const { fields } = extractInvoiceFields(RECEIPT, { ownVatNumber: '802160515' });
    expect(fields.phone).not.toContain('4902600240');
    expect(fields.phone).not.toContain('400014986629813');
    expect(fields.phone).not.toContain('035371947');
  });

  it('reads nothing rather than guessing when no phone is labelled', () => {
    const bare = ['ΤΙΜΟΛΟΓΙΟ #1', 'IBAN GR4902600240000110201244724', 'ΣΥΝΟΛΟ: 10,00€'].join('\n');
    expect(extractInvoiceFields(bare, {}).fields.phone).toBeNull();
  });

  it('leaves the rest of the reading alone', () => {
    const { fields, missing } = extractInvoiceFields(RECEIPT, { ownVatNumber: '802160515' });

    expect(missing).toEqual([]);
    expect(fields.debtorName).toBe('ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ');
    expect(fields.vatNumber).toBe('035371947');
    expect(fields.amountCents).toBe(5000);
  });
});

describe('whose contact it is', () => {
  const twoColumn = (issuerPhone: string, customerPhone: string) =>
    [
      'FAKTURA VAT nr 1/2026',
      'Sprzedawca    Nabywca',
      'ACME Sp. z o.o.    Kowalski Transport',
      `Tel: ${issuerPhone}    Tel: ${customerPhone}`,
      'Do zapłaty: 100,00 zł',
    ].join('\n');

  it('takes the customer column, not the issuer one', () => {
    const { fields } = extractInvoiceFields(twoColumn('221234567', '600100200'), {});
    expect(fields.phone).toBe('600100200');
  });

  it('never returns the tenant their own number', () => {
    // A letterhead phone with no heading around it would otherwise be the only
    // candidate, and the tenant would be reminded about their own invoice.
    const letterhead = ['ACME Sp. z o.o.', 'Tel: 221234567', 'FAKTURA nr 1', 'Do zapłaty: 10,00 zł'].join(
      '\n',
    );

    expect(extractInvoiceFields(letterhead, { ownPhone: '+48 22 123 45 67' }).fields.phone).toBeNull();
  });

  it('never returns the tenant their own address either', () => {
    const text = ['FAKTURA nr 1', 'billing@acme.pl', 'Do zapłaty: 10,00 zł'].join('\n');

    expect(extractInvoiceFields(text, { ownEmail: 'BILLING@acme.pl' }).fields.email).toBeNull();
  });

  it('reads an email without needing a label', () => {
    const text = ['FAKTURA nr 1', 'Nabywca', 'Kowalski', 'jan@kowalski.pl'].join('\n');
    expect(extractInvoiceFields(text, {}).fields.email).toBe('jan@kowalski.pl');
  });
});

/**
 * An address is easier to find than a phone and harder to attribute.
 *
 * A phone is only read where a label says it is one. An email needs no label —
 * the @ is unambiguous — so every address on the page is a candidate, including
 * the issuer's. And unlike a tax number, an issuer's address is usually in the
 * footer, which is to say last: the one position a "take the last one" rule
 * would hand back.
 */
describe('an email that might belong to either party', () => {
  it('takes the one under a contact heading', () => {
    const text = [
      'ΤΙΜΟΛΟΓΙΟ #7',
      'ΑΠΟ    ΠΕΛΑΤΗΣ',
      'Penny IKE    ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ',
      'Πληροφορίες επικοινωνίας',
      'Email: maria@example.gr',
      'ΣΥΝΟΛΟ: 10,00€',
      'accounts@penny.gr',
    ].join('\n');

    expect(extractInvoiceFields(text, {}).fields.email).toBe('maria@example.gr');
  });

  it('refuses to guess when two addresses have nothing to tell them apart', () => {
    // This is the case that used to return the footer, which is the issuer's.
    // A blank gets typed in; a reminder sent to the wrong person does not get
    // noticed at all.
    const text = [
      'FAKTURA nr 1/2026',
      'ACME Sp. z o.o.',
      'biuro@acme.pl',
      'Do zapłaty: 100,00 zł',
      'kontakt@acme.pl',
    ].join('\n');

    expect(extractInvoiceFields(text, {}).fields.email).toBeNull();
  });

  it('refuses a lone address that sits under the issuer and nowhere near the customer', () => {
    const text = [
      'FAKTURA nr 1/2026',
      'Sprzedawca',
      'ACME Sp. z o.o.',
      'biuro@acme.pl',
      'Do zapłaty: 100,00 zł',
    ].join('\n');

    expect(extractInvoiceFields(text, {}).fields.email).toBeNull();
  });

  it('still takes a lone address on a document that names nobody', () => {
    // No headings at all is the common small-business invoice, and the only
    // address on it is the one to write to.
    const text = ['FAKTURA nr 1/2026', 'jan@kowalski.pl', 'Do zapłaty: 100,00 zł'].join('\n');

    expect(extractInvoiceFields(text, {}).fields.email).toBe('jan@kowalski.pl');
  });

  it('takes the customer column when both parties print one', () => {
    const text = [
      'FAKTURA nr 1/2026',
      'Sprzedawca    Nabywca',
      'ACME Sp. z o.o.    Kowalski Transport',
      'biuro@acme.pl    jan@kowalski.pl',
      'Do zapłaty: 100,00 zł',
    ].join('\n');

    expect(extractInvoiceFields(text, {}).fields.email).toBe('jan@kowalski.pl');
  });

  it('applies the same caution to a phone', () => {
    const text = [
      'FAKTURA nr 1/2026',
      'Sprzedawca',
      'ACME Sp. z o.o.',
      'Tel: 221234567',
      'Do zapłaty: 100,00 zł',
    ].join('\n');

    expect(extractInvoiceFields(text, {}).fields.phone).toBeNull();
  });
});
