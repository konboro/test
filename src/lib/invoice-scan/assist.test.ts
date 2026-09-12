import { describe, expect, it, vi } from 'vitest';
import { parseAssisted } from './assist';
import { readInvoiceDocument } from './read';

describe('parseAssisted', () => {
  it('reads the fields out of a fenced answer', () => {
    const fields = parseAssisted(
      'Here you go:\n```json\n{"debtorName":"Acme","amountCents":17000,"currency":"EUR"}\n```',
    );
    expect(fields).toEqual({ debtorName: 'Acme', amountCents: 17000, currency: 'EUR' });
  });

  it('keeps nothing from an answer that is not JSON', () => {
    expect(parseAssisted('I could not find any fields in this document.')).toEqual({});
    expect(parseAssisted('{ this is not json')).toEqual({});
  });

  it('drops an amount that is not a whole positive number of cents', () => {
    for (const amountCents of [170.5, -100, 0, '17000', null]) {
      expect(parseAssisted(JSON.stringify({ amountCents }))).toEqual({});
    }
  });

  it('drops a date that is not ISO', () => {
    expect(parseAssisted('{"issueDate":"12 Aug 2026","dueDate":"2026-08-27"}')).toEqual({
      dueDate: '2026-08-27',
    });
  });

  it('keeps only a plausible tax number, digits alone', () => {
    expect(parseAssisted('{"vatNumber":"EL 156954440"}')).toEqual({ vatNumber: '156954440' });
    expect(parseAssisted('{"vatNumber":"12"}')).toEqual({});
  });

  it('drops a currency that is not a three letter code', () => {
    expect(parseAssisted('{"currency":"euro"}')).toEqual({});
  });
});

const pdf = { bytes: new Uint8Array(), mimeType: 'application/pdf' };

/** A PDF whose text layer is whatever the test wants it to be. */
function withText(text: string) {
  return vi.doMock('unpdf', () => ({
    extractText: async () => ({ text, totalPages: 1 }),
    getDocumentProxy: async () => ({ numPages: 1 }),
  }));
}

describe('reading a document with the model as a backstop', () => {
  it('does not ask the model when the labels found everything', async () => {
    const assist = vi.fn();
    const complete = [
      'INVOICE #10000-42',
      'DATE: 2026-08-12',
      'BILL TO',
      'Acme Ltd',
      'VAT: 156954440',
      'TOTAL DUE: 170,00 EUR',
    ].join('\n');

    vi.resetModules();
    withText(complete);
    const { readInvoiceDocument: read } = await import('./read');

    const result = await read(pdf, { assist });

    expect(result.missing).toEqual([]);
    expect(assist).not.toHaveBeenCalled();
  });

  it('asks the model for the fields the labels missed, and keeps the rest', async () => {
    const assist = vi.fn(async () => ({
      debtorName: 'Acme Ltd',
      invoiceNumber: 'WRONG-1',
      amountCents: 17000,
      issueDate: '2026-08-12',
    }));

    vi.resetModules();
    withText('SOMETHING UNUSUAL\nINVOICE #10000-42\nnothing else the parser knows');
    const { readInvoiceDocument: read } = await import('./read');

    const result = await read(pdf, { assist });

    expect(assist).toHaveBeenCalledOnce();
    // The parser read this one off the document, so the model does not get to
    // change it.
    expect(result.fields.invoiceNumber).toBe('10000-42');
    expect(result.fields.amountCents).toBe(17000);
    expect(result.fields.debtorName).toBe('Acme Ltd');
    expect(result.missing).toEqual([]);
    expect(result.source).toBe('pdf_text');
  });

  it('still returns the parsed fields when the model is unavailable', async () => {
    const assist = vi.fn(async () => null);

    vi.resetModules();
    withText('SOMETHING UNUSUAL\nINVOICE #10000-42\nnothing else');
    const { readInvoiceDocument: read } = await import('./read');

    const result = await read(pdf, { assist });

    expect(result.fields.invoiceNumber).toBe('10000-42');
    expect(result.missing).toContain('amountCents');
  });
});

it('is exported for the upload route', () => {
  expect(typeof readInvoiceDocument).toBe('function');
});
