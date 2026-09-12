import { describe, expect, it } from 'vitest';

import { extractInvoiceFields } from './fields';

/**
 * A Greek sales invoice as its text layer comes out: issuer at the top with its
 * own ΑΦΜ, customer below with theirs, and a total block where the VAT line sits
 * between the net and the payable amount.
 */
const GREEK_INVOICE = [
  'ΣΤΟΙΧΕΙΑ ΕΚΔΟΤΗ',
  'PENNY MOBILITY A.E.',
  'ΑΦΜ: 800123456',
  'Λεωφ. Συγγρού 120, Αθήνα',
  '',
  'ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ',
  'Σειρά: Α',
  'Αριθμός: 1042',
  'Ημερομηνία έκδοσης: 31/07/2026',
  'Ημερομηνία λήξης: 30/08/2026',
  'ΜΑΡΚ: 400001234567890',
  '',
  'ΣΤΟΙΧΕΙΑ ΠΕΛΑΤΗ',
  'ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ',
  'ΑΦΜ: 094123456',
  'Ερμού 15, Θεσσαλονίκη',
  '',
  'Περιγραφή                     Ποσό',
  'Υπηρεσίες Ιουλίου          1.000,00',
  '',
  'Καθαρή αξία                1.000,00',
  'ΦΠΑ 24%                      240,00',
  'ΠΛΗΡΩΤΕΟ ΠΟΣΟ              1.240,00',
].join('\n');

describe('a Greek sales invoice', () => {
  const { fields, missing } = extractInvoiceFields(GREEK_INVOICE, {
    ownVatNumber: '800123456',
  });

  it('takes the customer VAT number, not the issuer one', () => {
    expect(fields.vatNumber).toBe('094123456');
  });

  it('takes the payable amount, not the net value', () => {
    // The failure this guards against does not look like a failure: 1.000,00 is
    // a real number on the page, and chasing it would under-collect by the VAT
    // on every invoice ever imported.
    expect(fields.amountCents).toBe(124000);
  });

  it('reads the document identity', () => {
    expect(fields.invoiceNumber).toBe('1042');
    expect(fields.series).toBe('Α');
    expect(fields.mark).toBe('400001234567890');
  });

  it('reads both dates, day first', () => {
    expect(fields.issueDate).toBe('2026-07-31');
    expect(fields.dueDate).toBe('2026-08-30');
  });

  it('finds the customer name under its heading', () => {
    expect(fields.debtorName).toBe('ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ');
  });

  it('has nothing to ask the operator for', () => {
    expect(missing).toEqual([]);
    expect(fields.currency).toBe('EUR');
  });
});

const ENGLISH_INVOICE = [
  'ACME SERVICES LTD',
  'VAT No: 800123456',
  '',
  'INVOICE',
  'Invoice No: INV-2026-0044',
  'Issue date: 2026-07-05',
  'Due date: 2026-08-04',
  '',
  'Bill to',
  'Northwind Trading GmbH',
  'VAT ID: 094999888',
  '',
  'Subtotal              820.00',
  'VAT 24%               196.80',
  'Amount due          1,016.80',
].join('\n');

describe('an invoice issued in English', () => {
  const { fields, missing } = extractInvoiceFields(ENGLISH_INVOICE, {
    ownVatNumber: '800123456',
  });

  it('reads it as readily as the Greek one', () => {
    expect(fields.invoiceNumber).toBe('INV-2026-0044');
    expect(fields.issueDate).toBe('2026-07-05');
    expect(fields.dueDate).toBe('2026-08-04');
    expect(fields.debtorName).toBe('Northwind Trading GmbH');
    expect(fields.vatNumber).toBe('094999888');
    expect(missing).toEqual([]);
  });

  it('takes the amount due over the subtotal, with a comma thousands mark', () => {
    expect(fields.amountCents).toBe(101680);
  });
});

describe('picking the amount', () => {
  it('accepts a total that names VAT because it includes it', () => {
    const text = ['Καθαρή αξία 500,00', 'ΦΠΑ 24% 120,00', 'ΣΥΝΟΛΟ ΜΕ ΦΠΑ 620,00'].join('\n');
    expect(extractInvoiceFields(text).fields.amountCents).toBe(62000);
  });

  it('falls back to a plain total when nothing names itself payable', () => {
    const text = ['Περιγραφή', 'Υπηρεσίες 300,00', 'ΣΥΝΟΛΟ 300,00'].join('\n');
    expect(extractInvoiceFields(text).fields.amountCents).toBe(30000);
  });

  it('never returns the VAT line as the amount', () => {
    const text = ['ΣΥΝΟΛΟ 1.000,00', 'ΦΠΑ 24% 240,00'].join('\n');
    expect(extractInvoiceFields(text).fields.amountCents).toBe(100000);
  });
});

describe('picking the customer VAT number', () => {
  it('prefers the one under a customer heading', () => {
    const text = ['ΑΦΜ 111111111', 'ΠΕΛΑΤΗΣ', 'ΑΦΜ 222222222'].join('\n');
    expect(extractInvoiceFields(text).fields.vatNumber).toBe('222222222');
  });

  it('falls back to the last one when nothing is labelled', () => {
    // The letterhead comes first, so the issuer is the one at the top.
    const text = ['ΑΦΜ 111111111', 'ΑΦΜ 222222222'].join('\n');
    expect(extractInvoiceFields(text).fields.vatNumber).toBe('222222222');
  });

  it('ignores nine digits that no label introduced', () => {
    const text = ['Κωδικός 123456789', 'ΑΦΜ 094123456'].join('\n');
    expect(extractInvoiceFields(text).fields.vatNumber).toBe('094123456');
  });
});

describe('what it refuses to invent', () => {
  it('reports every required field it could not read', () => {
    const { fields, missing } = extractInvoiceFields('Ευχαριστούμε για τη συνεργασία.');

    expect(fields.invoiceNumber).toBeNull();
    expect(fields.amountCents).toBeNull();
    expect(missing).toContain('invoiceNumber');
    expect(missing).toContain('amountCents');
    expect(missing).toContain('issueDate');
    expect(missing).toContain('customer');
  });

  it('survives an empty document', () => {
    expect(() => extractInvoiceFields('')).not.toThrow();
    expect(extractInvoiceFields('').missing.length).toBe(4);
  });
});

describe('Greek as it is actually typeset', () => {
  it('reads lower case with accents', () => {
    const text = ['Αριθμός: 77', 'Ημερομηνία: 12/03/2026', 'Πληρωτέο ποσό: 55,50', 'ΑΦΜ 094123456'].join('\n');
    const { fields } = extractInvoiceFields(text);

    expect(fields.invoiceNumber).toBe('77');
    expect(fields.issueDate).toBe('2026-03-12');
    expect(fields.amountCents).toBe(5550);
  });

  it('matches a Greek label at all', () => {
    // Guards the bug that made every Greek label dead on arrival: JavaScript's
    // \b is ASCII-only, so /\bΑΦΜ\b/ can never match. If this ever returns null
    // again, someone has reintroduced an ASCII word boundary.
    expect(extractInvoiceFields('ΑΦΜ 094123456').fields.vatNumber).toBe('094123456');
  });
});

/**
 * The layout that sent us here.
 *
 * A real Elorus invoice, with the customer's name and tax number replaced. It
 * read as almost nothing: the month was a Greek abbreviation, the number came
 * after a bare `#`, the customer sat under `ΠΕΛΑΤΗΣ`, the due date under
 * `ΕΞΟΦΛΗΣΗ ΕΩΣ`, and the first total on the page was the net value.
 */
describe('a Greek services invoice', () => {
  const text = [
    'PENNY IKE',
    'ΑΦΜ: 802160515',
    'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ #10000-42',
    'ΗΜΕΡΟΜΗΝΙΑ: 12 Αύγ 2026, 11:42',
    'ΕΞΟΦΛΗΣΗ ΕΩΣ: 27 Αύγ 2026',
    'ΠΕΛΑΤΗΣ',
    'ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ',
    'ΑΦΜ: 156954440',
    'Συνολική καθαρή αξία: 137,10€',
    'ΦΠΑ (24%): 32,90€',
    'Τελική αξία: 170,00€',
    'MARK: 400014828080727',
  ].join('\n');

  it('reads every field', () => {
    const { fields, missing } = extractInvoiceFields(text, { ownVatNumber: '802160515' });

    expect(missing).toEqual([]);
    expect(fields.invoiceNumber).toBe('10000-42');
    expect(fields.debtorName).toBe('ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ');
    expect(fields.issueDate).toBe('2026-08-12');
    expect(fields.dueDate).toBe('2026-08-27');
    expect(fields.mark).toBe('400014828080727');
  });

  it('bills the final value, not the net one', () => {
    const { fields } = extractInvoiceFields(text, { ownVatNumber: '802160515' });
    expect(fields.amountCents).toBe(17000);
  });

  it('takes the customer tax number, not the issuer one', () => {
    const { fields } = extractInvoiceFields(text, { ownVatNumber: '802160515' });
    expect(fields.vatNumber).toBe('156954440');
  });
});

describe('Greek month names', () => {
  const on = (date: string) =>
    extractInvoiceFields(`INVOICE #1\nΗΜΕΡΟΜΗΝΙΑ: ${date}\nΣΥΝΟΛΟ: 10,00€\nΑΦΜ: 156954440`, {})
      .fields.issueDate;

  it('reads the abbreviated and the full form alike', () => {
    expect(on('12 Αύγ 2026')).toBe('2026-08-12');
    expect(on('1 Αυγούστου 2026')).toBe('2026-08-01');
    expect(on('9 Ιαν 2026')).toBe('2026-01-09');
  });

  it('keeps June and July apart', () => {
    expect(on('3 Ιουν 2026')).toBe('2026-06-03');
    expect(on('3 Ιουλ 2026')).toBe('2026-07-03');
  });
});
