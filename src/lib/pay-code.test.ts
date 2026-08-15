import { describe, expect, it } from 'vitest';

import { isPayCode, PAY_CODE_LENGTH, payCredentialColumn, payPath } from './pay-code';

const CODE = 'K7MQ2XR9PT';
const LEGACY_TOKEN = 'a'.repeat(48);

describe('short payment codes', () => {
  it('accepts a well-formed code', () => {
    expect(CODE).toHaveLength(PAY_CODE_LENGTH);
    expect(isPayCode(CODE)).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isPayCode('K7MQ2XR9P')).toBe(false);
    expect(isPayCode('K7MQ2XR9PTU')).toBe(false);
    expect(isPayCode('')).toBe(false);
  });

  it('rejects glyphs left out of the alphabet', () => {
    // 0/O and 1/I are the pairs a debtor misreads off a printed invoice.
    expect(isPayCode('K7MQ2XR9P0')).toBe(false);
    expect(isPayCode('K7MQ2XR9P1')).toBe(false);
    expect(isPayCode('K7MQ2XR9PO')).toBe(false);
    expect(isPayCode('K7MQ2XR9PI')).toBe(false);
  });

  it('rejects anything lowercase', () => {
    expect(isPayCode(CODE.toLowerCase())).toBe(false);
  });

  it('never matches one of the app’s own routes', () => {
    // The root-level route and the middleware both gate on this. If a route name
    // could pass as a code, an unauthenticated visitor would reach the page
    // behind it — so this is a regression guard, not a formality.
    for (const route of [
      'login',
      'register',
      'auth',
      'pay',
      'api',
      'dashboard',
      'debtors',
      'invoices',
      'logs',
      'settings',
    ]) {
      expect(isPayCode(route)).toBe(false);
    }
  });
});

describe('credential routing', () => {
  it('sends a short code to short_code and a legacy token to pay_token', () => {
    expect(payCredentialColumn(CODE)).toBe('short_code');
    expect(payCredentialColumn(LEGACY_TOKEN)).toBe('pay_token');
  });

  it('keeps each credential on the URL shape it was mailed with', () => {
    expect(payPath(CODE)).toBe(`/${CODE}`);
    expect(payPath(LEGACY_TOKEN)).toBe(`/pay/${LEGACY_TOKEN}`);
  });
});
