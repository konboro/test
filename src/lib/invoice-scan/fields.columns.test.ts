import { describe, expect, it } from 'vitest';
import { extractInvoiceFields } from './fields';

/**
 * Seller and buyer printed side by side.
 *
 * This is the ordinary Polish invoice layout and it is the one that billed the
 * wrong company: the text layer flattens each row into a single line, so the
 * buyer's tax number shared a line with the seller's and was never seen. One
 * candidate remained — the letterhead — and it was returned as the debtor.
 */
const SELLER_LEFT = [
  'FAKTURA VAT nr FV/2026/08/17',
  'Data wystawienia: 2026-08-14',
  'Termin płatności: 2026-08-28',
  '',
  'Sprzedawca                                  Nabywca',
  'ACME Software Sp. z o.o.                    Kowalski Transport Sp. z o.o.',
  'ul. Prosta 51                               ul. Długa 7',
  '00-838 Warszawa                             31-147 Kraków',
  'NIP: 5252445111                             NIP: 6772391626',
  '',
  'Razem do zapłaty: 4 305,00 zł',
].join('\n');

/** The same document with the columns the other way round. */
const BUYER_LEFT = [
  'FAKTURA VAT nr FV/2026/08/17',
  'Data wystawienia: 2026-08-14',
  '',
  'Nabywca                                     Sprzedawca',
  'Kowalski Transport Sp. z o.o.               ACME Software Sp. z o.o.',
  'NIP: 6772391626                             NIP: 5252445111',
  '',
  'Razem do zapłaty: 4 305,00 zł',
].join('\n');

/** One block after the other, which is the layout that always worked. */
const STACKED = [
  'FAKTURA VAT nr FV/2026/08/17',
  'Data wystawienia: 2026-08-14',
  '',
  'Sprzedawca',
  'ACME Software Sp. z o.o.',
  'NIP: 5252445111',
  '',
  'Nabywca',
  'Kowalski Transport Sp. z o.o.',
  'NIP: 6772391626',
  '',
  'Razem do zapłaty: 4 305,00 zł',
].join('\n');

describe('a Polish invoice with two columns', () => {
  it('bills the buyer, not the seller, when the seller is on the left', () => {
    const { fields } = extractInvoiceFields(SELLER_LEFT, {});

    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
    expect(fields.vatNumber).toBe('6772391626');
  });

  it('bills the buyer when the columns are reversed', () => {
    const { fields } = extractInvoiceFields(BUYER_LEFT, {});

    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
    expect(fields.vatNumber).toBe('6772391626');
  });

  it('sees both tax numbers, not just the first one on the line', () => {
    // The seller's own number being known used to be the only thing standing
    // between this layout and a wrong debtor. It must not be load-bearing.
    const { fields } = extractInvoiceFields(SELLER_LEFT, { ownVatNumber: '5252445111' });
    expect(fields.vatNumber).toBe('6772391626');
  });

  it('reads the rest of the document as before', () => {
    const { fields, missing } = extractInvoiceFields(SELLER_LEFT, {});

    expect(missing).toEqual([]);
    expect(fields.amountCents).toBe(430500);
    expect(fields.issueDate).toBe('2026-08-14');
    expect(fields.dueDate).toBe('2026-08-28');
  });

  it('never returns the two names glued together', () => {
    const { fields } = extractInvoiceFields(SELLER_LEFT, {});
    expect(fields.debtorName).not.toContain('ACME');
  });
});

describe('a Polish invoice with the blocks stacked', () => {
  it('still bills the buyer', () => {
    const { fields } = extractInvoiceFields(STACKED, {});

    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
    expect(fields.vatNumber).toBe('6772391626');
  });
});

describe('the tenant is never their own debtor', () => {
  it('refuses a name that is the tenant company', () => {
    // A credit note or a self-billed document can put the tenant under the
    // customer heading. Dunning them for their own invoice is worse than
    // asking a person to fill the name in.
    const text = ['Nabywca', 'ACME Software Sp. z o.o.', 'NIP: 5252445111'].join('\n');

    const { fields } = extractInvoiceFields(text, { ownName: 'ACME Software Sp. z o.o.' });
    expect(fields.debtorName).toBeNull();
  });

  it('matches the name regardless of case and spacing', () => {
    const text = ['Nabywca', 'ACME   SOFTWARE  sp. z o.o.'].join('\n');

    const { fields } = extractInvoiceFields(text, { ownName: 'Acme Software Sp. z o.o.' });
    expect(fields.debtorName).toBeNull();
  });

  it('leaves a genuine customer alone', () => {
    const text = ['Nabywca', 'Kowalski Transport Sp. z o.o.'].join('\n');

    const { fields } = extractInvoiceFields(text, { ownName: 'ACME Software Sp. z o.o.' });
    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
  });
});
