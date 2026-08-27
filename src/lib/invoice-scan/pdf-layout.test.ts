import { describe, expect, it } from 'vitest';
import { pdfText, readInvoiceDocument } from './read';

/**
 * A PDF built here rather than committed as a binary.
 *
 * What is being tested is how a text layer flattens two columns, and that only
 * exists in a file with real text positioning. Writing one is a page of code and
 * leaves the layout readable in the diff, which a checked-in blob does not. It
 * also keeps a real customer's invoice out of the repository.
 */
function invoicePdf(rows: Array<[number, number, string]>): Uint8Array {
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const content =
    'BT\n/F1 10 Tf\n' +
    rows.map(([x, y, text]) => `1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj`).join('\n') +
    '\nET\n';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Seller on the left, buyer on the right — the ordinary Polish invoice. */
const TWO_COLUMN: Array<[number, number, string]> = [
  [60, 790, 'FAKTURA VAT nr FV/2026/08/17'],
  [60, 772, 'Data wystawienia: 2026-08-14'],
  [60, 754, 'Termin platnosci: 2026-08-28'],

  [60, 710, 'Sprzedawca'],
  [330, 710, 'Nabywca'],
  [60, 692, 'ACME Software Sp. z o.o.'],
  [330, 692, 'Kowalski Transport Sp. z o.o.'],
  [60, 674, 'ul. Prosta 51'],
  [330, 674, 'ul. Dluga 7'],
  [60, 656, 'NIP: 5252445111'],
  [330, 656, 'NIP: 6772391626'],

  [60, 560, 'Razem do zaplaty: 4 305,00 PLN'],
];

/**
 * The layout that billed the wrong company.
 *
 * pdf.js reports the empty page between two columns as an item whose text is a
 * single space and whose width is the entire gap. Flattening that the ordinary
 * way produced "ACME Software Sp. z o.o. Kowalski Transport Sp. z o.o." — one
 * line with nothing left to say where the seller ended and the buyer began.
 */
describe('a PDF printed in two columns', () => {
  it('keeps the gap between the columns', async () => {
    const { text } = await pdfText(invoicePdf(TWO_COLUMN));

    expect(text).toContain('Sprzedawca    Nabywca');
    expect(text).toContain('NIP: 5252445111    NIP: 6772391626');
  });

  it('reads the buyer as the debtor', async () => {
    const { fields, missing } = await readInvoiceDocument(
      { bytes: invoicePdf(TWO_COLUMN), mimeType: 'application/pdf' },
      { assist: async () => null },
    );

    expect(missing).toEqual([]);
    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
    expect(fields.vatNumber).toBe('6772391626');
  });

  it('never returns the seller glued to the buyer', async () => {
    const { fields } = await readInvoiceDocument(
      { bytes: invoicePdf(TWO_COLUMN), mimeType: 'application/pdf' },
      { assist: async () => null },
    );

    expect(fields.debtorName).not.toContain('ACME');
  });

  it('reads the rest of the document too', async () => {
    const { fields } = await readInvoiceDocument(
      { bytes: invoicePdf(TWO_COLUMN), mimeType: 'application/pdf' },
      { assist: async () => null },
    );

    expect(fields.invoiceNumber).toBe('FV/2026/08/17');
    expect(fields.issueDate).toBe('2026-08-14');
    expect(fields.dueDate).toBe('2026-08-28');
    expect(fields.amountCents).toBe(430500);
    expect(fields.currency).toBe('PLN');
  });

  it('does not need to ask a model', async () => {
    let asked = false;

    await readInvoiceDocument(
      { bytes: invoicePdf(TWO_COLUMN), mimeType: 'application/pdf' },
      {
        assist: async () => {
          asked = true;
          return null;
        },
      },
    );

    expect(asked).toBe(false);
  });
});

describe('a single-column PDF', () => {
  it('reads as it always did', async () => {
    const stacked: Array<[number, number, string]> = [
      [60, 790, 'FAKTURA VAT nr FV/2026/08/18'],
      [60, 772, 'Data wystawienia: 2026-08-14'],
      [60, 730, 'Sprzedawca'],
      [60, 712, 'ACME Software Sp. z o.o.'],
      [60, 694, 'NIP: 5252445111'],
      [60, 656, 'Nabywca'],
      [60, 638, 'Kowalski Transport Sp. z o.o.'],
      [60, 620, 'NIP: 6772391626'],
      [60, 560, 'Razem do zaplaty: 4 305,00 PLN'],
    ];

    const { fields } = await readInvoiceDocument(
      { bytes: invoicePdf(stacked), mimeType: 'application/pdf' },
      { assist: async () => null },
    );

    expect(fields.debtorName).toBe('Kowalski Transport Sp. z o.o.');
    expect(fields.vatNumber).toBe('6772391626');
    expect(fields.amountCents).toBe(430500);
  });
});
