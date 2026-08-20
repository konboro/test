import { describe, expect, it } from 'vitest';

import { extractInvoiceFields } from './fields';

/**
 * A real Polish invoice, as its text layer actually came out of the uploader.
 *
 * Kept verbatim — including the REGON sitting one line above the NIP, and the
 * thousands grouped with a space — because every one of those details broke
 * something. Names and numbers are from the document that was uploaded.
 */
const POLISH_INVOICE = [
  'Faktura 6/04/2024',
  'Data wystawienia 2024-04-01',
  'Data Sprzedaży 2024-04-01',
  'Termin płatności 2024-04-10',
  'Nabywca:',
  'BLUEBERRY ROASTERS SP. Z O.O.',
  'ul. Tadeusza Kościuszki 16A',
  '50-038 Wrocław',
  'DOLNOŚLĄSKIE',
  'Regon 385198357',
  'NIP 8971874881',
  'Sprzedawca:',
  'ELENI BOROWIEC "BOROWIEC"',
  'Rynek 26A',
  '50-101 Wrocław',
  'DOLNOŚLĄSKIE',
  'Regon 005986603',
  'NIP 8970001346',
  'Opis Ilość Miara Cena Kwota netto',
  'Wynajem pomieszczeń 1 szt. 1 000,00 1 000,00',
  'Podstawa VAT 23% 1 000,00',
  'VAT 23% 230,00',
  'Do zapłaty (PLN) 1 230,00',
].join('\n');

describe('a Polish invoice', () => {
  const { fields, missing } = extractInvoiceFields(POLISH_INVOICE, {
    ownVatNumber: '8970001346',
  });

  it('reads the payable amount, spaces and all', () => {
    // The failure this guards against is silent and enormous: a pattern that
    // stops at the thousands space reads 1 230,00 as 230,00 — the same invoice,
    // off by a factor of a thousand, with nothing on screen to suggest it.
    expect(fields.amountCents).toBe(123000);
  });

  it('takes the buyer NIP and not the REGON beside it', () => {
    // REGON is nine digits, which is exactly the shape a Greek VAT number has.
    expect(fields.vatNumber).toBe('8971874881');
  });

  it('reads the document number from the word Faktura', () => {
    expect(fields.invoiceNumber).toBe('6/04/2024');
  });

  it('separates the issue date from the payment deadline', () => {
    expect(fields.issueDate).toBe('2024-04-01');
    expect(fields.dueDate).toBe('2024-04-10');
  });

  it('finds the buyer under Nabywca, not the seller under Sprzedawca', () => {
    expect(fields.debtorName).toBe('BLUEBERRY ROASTERS SP. Z O.O.');
  });

  it('notices the invoice is in złoty', () => {
    expect(fields.currency).toBe('PLN');
  });

  it('has nothing left to ask for', () => {
    expect(missing).toEqual([]);
  });
});

describe('Polish letters that Unicode does not decompose', () => {
  it('matches a label containing Ł', () => {
    // Ł is its own letter, not L with a mark, so NFD leaves it intact and every
    // pattern written with a plain L would miss "Termin płatności".
    const { fields } = extractInvoiceFields(
      ['Faktura 1/2026', 'Data wystawienia 2026-01-05', 'Termin płatności 2026-02-05', 'Do zapłaty 500,00'].join('\n'),
    );

    expect(fields.dueDate).toBe('2026-02-05');
    expect(fields.amountCents).toBe(50000);
  });
});
