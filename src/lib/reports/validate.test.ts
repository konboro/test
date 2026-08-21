import { describe, expect, it } from 'vitest';

import {
  chatRequestSchema,
  detailsFrom,
  MAX_TURNS,
  parseClaimedAmount,
  submitReportSchema,
} from './validate';

describe('chatRequestSchema', () => {
  const base = { token: 'ABCDEF2345', kind: 'paid_claim', messages: [] };

  it('accepts the opening request and a normal turn', () => {
    expect(chatRequestSchema.safeParse(base).success).toBe(true);
    expect(
      chatRequestSchema.safeParse({
        ...base,
        messages: [
          { role: 'assistant', content: 'Πότε πληρώσατε;' },
          { role: 'user', content: 'Χθες, με έμβασμα.' },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses what only an abuser would send', () => {
    // The caps are the cost model of an anonymous endpoint.
    expect(
      chatRequestSchema.safeParse({
        ...base,
        messages: Array.from({ length: MAX_TURNS + 1 }, () => ({
          role: 'user',
          content: 'x',
        })),
      }).success,
    ).toBe(false);

    expect(
      chatRequestSchema.safeParse({
        ...base,
        messages: [{ role: 'user', content: 'x'.repeat(1300) }],
      }).success,
    ).toBe(false);

    expect(chatRequestSchema.safeParse({ ...base, token: 'has spaces!' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, kind: 'refund' }).success).toBe(false);
  });
});

describe('submitReportSchema', () => {
  it('accepts what the tool is meant to file', () => {
    const parsed = submitReportSchema.safeParse({
      kind: 'paid_claim',
      summary: 'Δηλώνει έμβασμα 455,00 € στις 03/09.',
      claimed_paid_on: '2026-09-03',
      claimed_amount_cents: 45500,
      method: 'transfer',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a payload without the one required fact', () => {
    expect(submitReportSchema.safeParse({ kind: 'dispute' }).success).toBe(false);
    expect(
      submitReportSchema.safeParse({ kind: 'dispute', summary: '' }).success,
    ).toBe(false);
  });

  it('refuses junk dates and impossible amounts', () => {
    expect(
      submitReportSchema.safeParse({
        kind: 'paid_claim',
        summary: 'x',
        claimed_paid_on: '3/9/2026',
      }).success,
    ).toBe(false);
    expect(
      submitReportSchema.safeParse({
        kind: 'paid_claim',
        summary: 'x',
        claimed_amount_cents: -5,
      }).success,
    ).toBe(false);
  });
});

describe('parseClaimedAmount', () => {
  it('reads money the way Greek humans type it', () => {
    expect(parseClaimedAmount('455')).toBe(45500);
    expect(parseClaimedAmount('455,00')).toBe(45500);
    expect(parseClaimedAmount('1.234,56')).toBe(123456);
    expect(parseClaimedAmount('1234.56')).toBe(123456);
    expect(parseClaimedAmount('€ 455,00')).toBe(45500);
  });

  it('is null for anything that is not an amount', () => {
    expect(parseClaimedAmount('')).toBeNull();
    expect(parseClaimedAmount(undefined)).toBeNull();
    expect(parseClaimedAmount('πλήρωσα')).toBeNull();
    expect(parseClaimedAmount('-45')).toBeNull();
  });
});

describe('detailsFrom', () => {
  it('keeps the dispute reason only on disputes', () => {
    const submitted = {
      kind: 'paid_claim' as const,
      summary: 'x',
      dispute_reason: 'should not survive',
    };
    expect(detailsFrom('paid_claim', submitted).dispute_reason).toBeUndefined();
    expect(detailsFrom('dispute', { ...submitted, kind: 'dispute' }).dispute_reason).toBe(
      'should not survive',
    );
  });

  it('drops empty optionals instead of storing nulls', () => {
    const details = detailsFrom('paid_claim', { kind: 'paid_claim', summary: 'x' });
    expect(Object.keys(details)).toEqual(['summary']);
  });
});
