import { describe, expect, it } from 'vitest';

import { extractInvoiceFields } from './fields';

/**
 * The same invoicing tool, with the document language switched to English.
 *
 * Everything about it is familiar except the words, and the words were the
 * whole problem: the issuer column is headed FROM, which was not a marker, so
 * the layout did not read as two columns and both parties arrived as one name.
 * The date is spelled the English way round, which parsed as nothing.
 */
const ENGLISH = [
  'BILL OF RENDERED SERVICES #ΑΠΥ-Β-38',
  'DATE: Jun 30, 2026',
  'DUE DATE: Jul 15, 2026',
  'FROM    CLIENT',
  'Penny IKE    Jan Geesmann',
  "Tax ID: 802160515, Tax office: D' Thessalonikis",
  'ΑΜΜΟΧΩΣΤΟΥ 5, ΘΕΣΣΑΛΟΝΙΚΗ 54454, Greece',
  'Net total:    161.00€',
  'VAT (24%):    38.63€',
  'Total:    199.63€',
  'MARK: 400014180417924',
].join('\n');

const read = () => extractInvoiceFields(ENGLISH, { ownVatNumber: '802160515' }).fields;

describe('an English invoice from the same tool', () => {
  it('reads the customer, not both parties glued together', () => {
    // "Penny IKE    Jan Geesmann" was arriving whole, because FROM was not
    // recognised and one recognised heading is not a two-column layout.
    expect(read().debtorName).toBe('Jan Geesmann');
  });

  it('reads a date written the English way round', () => {
    expect(read().issueDate).toBe('2026-06-30');
    expect(read().dueDate).toBe('2026-07-15');
  });

  it('bills the final total, not the net', () => {
    expect(read().amountCents).toBe(19963);
  });

  it('reads the number and the MARK', () => {
    expect(read().invoiceNumber).toBe('ΑΠΥ-Β-38');
    expect(read().mark).toBe('400014180417924');
  });

  it('does not offer the issuer tax number as the customer', () => {
    // The only tax number on this document is ours. The customer is a private
    // individual and has none, so the right answer is nothing at all.
    expect(read().vatNumber).toBeNull();
  });
});

describe('month names in both languages', () => {
  const on = (date: string) =>
    extractInvoiceFields(`INVOICE #1\nDATE: ${date}\nTotal: 10,00€`, {}).fields.issueDate;

  it('reads the English order, month first', () => {
    expect(on('Jun 30, 2026')).toBe('2026-06-30');
    expect(on('January 9, 2026')).toBe('2026-01-09');
    expect(on('Dec 1, 2026')).toBe('2026-12-01');
  });

  it('still reads the Greek order, day first', () => {
    expect(on('12 Αύγ 2026')).toBe('2026-08-12');
    expect(on('1 Αυγούστου 2026')).toBe('2026-08-01');
  });

  it('keeps the pairs that share three letters apart', () => {
    expect(on('Jun 3, 2026')).toBe('2026-06-03');
    expect(on('Jul 3, 2026')).toBe('2026-07-03');
    expect(on('Mar 3, 2026')).toBe('2026-03-03');
    expect(on('May 3, 2026')).toBe('2026-05-03');
  });
});
