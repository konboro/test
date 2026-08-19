import { describe, expect, it } from 'vitest';

import { readInvoiceDocument } from './read';

/**
 * A real, minimal PDF carrying a text layer.
 *
 * Built here rather than committed as a binary so the fixture can be read: the
 * point of the test is that a generated invoice is parsed exactly, and a blob
 * nobody can inspect would prove that far less convincingly.
 *
 * The lines below deliberately avoid brackets, which are the one thing a PDF
 * string would need escaped — a fixture is not the place to reimplement that.
 */
function pdfWithText(lines: string[]): Uint8Array {
  const content =
    'BT /F1 11 Tf 40 800 Td 14 TL\n' +
    lines.map((line) => `(${line}) Tj T*`).join('\n') +
    '\nET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

describe('reading a generated PDF', () => {
  it('reads the fields straight out of the text layer, with no model involved', async () => {
    const bytes = pdfWithText([
      'ACME SERVICES LTD',
      'VAT No: 800123456',
      'Invoice No: INV-2026-0044',
      'Issue date: 05/07/2026',
      'Bill to',
      'Northwind Trading GmbH',
      'VAT ID: 094999888',
      'Amount due 1.016,80',
    ]);

    const result = await readInvoiceDocument(
      { bytes, mimeType: 'application/pdf' },
      { ownVatNumber: '800123456' },
    );

    expect(result.source).toBe('pdf_text');
    expect(result.fields.invoiceNumber).toBe('INV-2026-0044');
    expect(result.fields.vatNumber).toBe('094999888');
    expect(result.fields.amountCents).toBe(101680);
    expect(result.fields.issueDate).toBe('2026-07-05');
    expect(result.missing).toEqual([]);
  });
});

describe('when there is no text to read', () => {
  it('asks for the fields instead of failing, and says why', async () => {
    const result = await readInvoiceDocument({
      bytes: new TextEncoder().encode('not a pdf at all'),
      mimeType: 'application/pdf',
    });

    expect(result.source).toBe('manual');
    expect(result.problem).toBe('no_text_layer');
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('reports an image as needing a model when none is configured', async () => {
    const result = await readInvoiceDocument({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    });

    expect(result.source).toBe('manual');
    expect(result.problem).toBe('vision_unavailable');
  });

  it('uses the model for an image when one is available', async () => {
    const result = await readInvoiceDocument(
      { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
      { vision: async () => 'Invoice No: 9\nDate: 01/02/2026\nTotal 10,00\nVAT ID: 094123456' },
    );

    expect(result.source).toBe('vision');
    expect(result.fields.invoiceNumber).toBe('9');
    expect(result.fields.amountCents).toBe(1000);
  });

  it('falls back to manual when the model reads nothing', async () => {
    const result = await readInvoiceDocument(
      { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
      { vision: async () => null },
    );

    expect(result.source).toBe('manual');
    expect(result.problem).toBe('unreadable');
  });
});
