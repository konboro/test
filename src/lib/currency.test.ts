import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  isSupportedCurrency,
  normaliseCurrency,
  SUPPORTED_CURRENCIES,
  totalsByCurrency,
} from './currency';

import { formatMoney } from './money';

describe('normaliseCurrency', () => {
  it('accepts the codes the product handles, in any case', () => {
    expect(normaliseCurrency('PLN')).toBe('PLN');
    expect(normaliseCurrency('pln')).toBe('PLN');
    expect(normaliseCurrency('Gbp')).toBe('GBP');
  });

  it('falls back rather than storing something no provider accepts', () => {
    // A three-letter string nobody can charge is not more truthful than the
    // default; it is an invoice that fails at the checkout instead of here.
    for (const value of ['XYZ', 'ευρώ', '', '   ', null, undefined, 42, {}]) {
      expect(normaliseCurrency(value), String(value)).toBe(DEFAULT_CURRENCY);
    }
  });

  it('agrees with isSupportedCurrency', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      expect(isSupportedCurrency(code)).toBe(true);
      expect(normaliseCurrency(code)).toBe(code);
    }
    expect(isSupportedCurrency('XYZ')).toBe(false);
  });

  it('leads with the currency this market actually invoices in', () => {
    expect(SUPPORTED_CURRENCIES[0]).toBe('EUR');
    expect(DEFAULT_CURRENCY).toBe('EUR');
  });
});

describe('totalsByCurrency', () => {
  it('never adds one currency to another', () => {
    // The whole point. Summed, these are 3000 of nothing.
    const totals = totalsByCurrency([
      { amount_cents: 1000, currency: 'EUR' },
      { amount_cents: 2000, currency: 'PLN' },
    ]);

    expect(totals).toEqual([
      { currency: 'PLN', cents: 2000, count: 1 },
      { currency: 'EUR', cents: 1000, count: 1 },
    ]);
  });

  it('adds up what does belong together', () => {
    const totals = totalsByCurrency([
      { amount_cents: 1000, currency: 'EUR' },
      { amount_cents: 250, currency: 'EUR' },
    ]);

    expect(totals).toEqual([{ currency: 'EUR', cents: 1250, count: 2 }]);
  });

  it('treats the same currency written differently as one', () => {
    const totals = totalsByCurrency([
      { amount_cents: 100, currency: 'eur' },
      { amount_cents: 100, currency: 'EUR' },
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0]?.cents).toBe(200);
  });

  it('leads with the largest, so the tile shows the figure that matters', () => {
    const totals = totalsByCurrency([
      { amount_cents: 100, currency: 'GBP' },
      { amount_cents: 900, currency: 'PLN' },
      { amount_cents: 500, currency: 'EUR' },
    ]);

    expect(totals.map((x) => x.currency)).toEqual(['PLN', 'EUR', 'GBP']);
  });

  it('orders ties by code rather than by chance', () => {
    // Two identical renders of the same book must not swap the columns around.
    const rows = [
      { amount_cents: 100, currency: 'PLN' },
      { amount_cents: 100, currency: 'EUR' },
    ];

    expect(totalsByCurrency(rows).map((x) => x.currency)).toEqual(['EUR', 'PLN']);
    expect(totalsByCurrency([...rows].reverse()).map((x) => x.currency)).toEqual(['EUR', 'PLN']);
  });

  it('reads a missing currency as the default rather than as its own bucket', () => {
    const totals = totalsByCurrency([
      { amount_cents: 100, currency: '' },
      { amount_cents: 100, currency: 'EUR' },
    ]);

    expect(totals).toEqual([{ currency: 'EUR', cents: 200, count: 2 }]);
  });

  it('has nothing to say about an empty book', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe('the figures that reach the screen', () => {
  it('carries its own symbol per currency', () => {
    // The bug this guards: one total formatted with the default euro sign while
    // holding zloty. Whatever the locale's punctuation, the mark must differ.
    const zloty = formatMoney(2000, 'PLN');
    const euro = formatMoney(2000, 'EUR');

    expect(zloty).not.toBe(euro);
    expect(euro).toContain('€');
    expect(zloty).not.toContain('€');
  });
});
