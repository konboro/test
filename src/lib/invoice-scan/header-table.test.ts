import { describe, expect, it } from 'vitest';

import { extractInvoiceFields } from './fields';

/**
 * The layout most Greek accounting software prints, with details anonymised.
 *
 * Two things about it break a reader written for forms. The document's own
 * details are a header row over a value row, so whatever follows a label on its
 * own line is the *next heading*, not an answer. And the party details are
 * three columns of label/value pairs, so a heading sits exactly where a name
 * would.
 *
 * It is also a purchase invoice — the tenant is the recipient — which is what
 * makes the contact details a trap: the buyer's phone box is printed and empty,
 * and the only phone on the page belongs to the supplier.
 */
const EPSILON = [
  'ΣΙΔΗΡΙΚΑ - ΧΡΩΜΑΤΑ - ΥΔΡΑΥΛΙΚΑ',
  'ΝΕΑΡΧΟΥ 1 - Τ.Κ. 54250 ΧΑΡΙΛΑΟΥ ΘΕΣΣΑΛΟΝΙΚΗ',
  'ΤΗΛ.: 2310 000000 - FAX: 2310 000001',
  'ΑΦΜ: 997613325 - Δ.Ο.Υ.: Ζ΄ ΘΕΣΣΑΛΟΝΙΚΗΣ',
  'email: info@example.gr',
  'ΕΙΔΟΣ ΠΑΡΑΣΤΑΤΙΚΟΥ    ΑΡΙΘΜΟΣ    ΣΕΙΡΑ    ΗΜΕΡΟΜΗΝΙΑ    ΩΡΑ    ΣΕΛΙΔΑ',
  'Τιμολόγιο - Δελτίο Αποστολής    42830    ΤΔΑ    25/6/2026    13:39    1 / 1',
  'ΣΤΟΙΧΕΙΑ ΠΕΛΑΤΗ    ΣΤΟΙΧΕΙΑ ΠΑΡΑΛΗΠΤΗ    ΣΤΟΙΧΕΙΑ ΠΑΡΑΣΤΑΤΙΚΟΥ',
  'ΚΩΔΙΚΟΣ    ΠΕΛΑ-00011544    ΚΩΔΙΚΟΣ    ΠΕΛΑ-00011544    ΤΟΠΟΣ ΦΟΡΤΩΣΗΣ    ΕΔΡΑ ΜΑΣ',
  'ΕΠΩΝΥΜΙΑ    PENNY ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ    ΕΠΩΝΥΜΙΑ    PENNY ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ',
  'ΔΙΕΥΘΥΝΣΗ    ΑΜΜΟΧΩΣΤΟΥ 5    ΔΙΕΥΘΥΝΣΗ    ΑΜΜΟΧΩΣΤΟΥ 5',
  'Α.Φ.Μ./Δ.Ο.Υ. 802160515 Δ΄ ΘΕΣΣΑΛΟΝΙΚΗΣ    Α.Φ.Μ./Δ.Ο.Υ. 802160515 Δ΄ ΘΕΣΣΑΛΟΝΙΚΗΣ',
  'ΤΗΛΕΦΩΝΟ    ΤΗΛΕΦΩΝΟ    ΣΧΕΤΙΚΑ ΠΑΡΑΣΤΑΤΙΚΑ',
  'ΣΥΝΟΛΟ    12,20',
].join('\n');

describe('a header row over a value row', () => {
  it('reads the number from beneath its heading, not the heading beside it', () => {
    // "ΑΡΙΘΜΟΣ  ΣΕΙΡΑ  ΗΜΕΡΟΜΗΝΙΑ" — read as a form, the number came back as
    // the rest of the header row.
    expect(extractInvoiceFields(EPSILON, {}).fields.invoiceNumber).toBe('42830');
  });

  it('reads the series from its own column', () => {
    expect(extractInvoiceFields(EPSILON, {}).fields.series).toBe('ΤΔΑ');
  });

  it('reads the date from its own column', () => {
    expect(extractInvoiceFields(EPSILON, {}).fields.issueDate).toBe('2026-06-25');
  });

  it('never returns a heading as a value', () => {
    const { fields } = extractInvoiceFields(EPSILON, {});

    for (const value of [fields.invoiceNumber, fields.series, fields.debtorName]) {
      expect(value ?? '').not.toContain('ΗΜΕΡΟΜΗΝΙΑ');
      expect(value ?? '').not.toContain('ΣΕΛΙΔΑ');
      expect(value ?? '').not.toContain('ΣΤΟΙΧΕΙΑ');
    }
  });

  it('takes the name from the details, not from the heading over them', () => {
    // ΣΤΟΙΧΕΙΑ ΠΑΡΑΛΗΠΤΗ — "recipient details" — sits exactly where a name
    // would in a three-column table, and was arriving as the customer.
    expect(extractInvoiceFields(EPSILON, {}).fields.debtorName).toBe(
      'PENNY ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ',
    );
  });
});

describe('a purchase invoice, where the only contact is the supplier', () => {
  const read = () => extractInvoiceFields(EPSILON, { ownVatNumber: '802160515' }).fields;

  it('does not offer the supplier phone as the customer', () => {
    expect(read().phone).toBeNull();
  });

  it('does not offer the supplier address as the customer', () => {
    expect(read().email).toBeNull();
  });

  it('does not offer the supplier tax number as the customer', () => {
    // Our own number is removed as the customer's, which leaves the supplier's
    // letterhead as the only candidate. A document that names its parties and
    // cannot place that number has not said it is the customer's.
    expect(read().vatNumber).toBeNull();
  });

  it('still reads everything the document does say', () => {
    const fields = read();

    expect(fields.invoiceNumber).toBe('42830');
    expect(fields.amountCents).toBe(1220);
  });
});
