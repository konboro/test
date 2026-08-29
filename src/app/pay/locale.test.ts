import { describe, expect, it } from 'vitest';

import { payCredentialFromPath } from './locale';

/**
 * The root layout decides the document language from the path alone, and the
 * root of this site is a catch-all: every mistyped URL arrives here too. Reading
 * one as a payment credential would send the layout to the database on requests
 * that have nothing to do with a payment.
 */
describe('payCredentialFromPath', () => {
  const code = 'QP66DL4ZZK'; // ten characters, the short-link shape
  const token = 'a'.repeat(48); // the long form older reminders carry

  it('recognises both payment routes', () => {
    expect(payCredentialFromPath(`/${code}`)).toBe(code);
    expect(payCredentialFromPath(`/pay/${token}`)).toBe(token);
  });

  it('tolerates a trailing slash', () => {
    expect(payCredentialFromPath(`/${code}/`)).toBe(code);
    expect(payCredentialFromPath(`/pay/${token}/`)).toBe(token);
  });

  it('leaves the app’s own pages alone', () => {
    for (const path of [
      '/',
      '/invoices',
      '/settings',
      '/settings/members',
      '/logs',
      '/pricing',
      '/odigos/mydata-anexoflita-timologia',
      '/api/pay/start',
    ]) {
      expect(payCredentialFromPath(path), path).toBeNull();
    }
  });

  it('rejects anything that is not credential-shaped', () => {
    // Nine characters, eleven, and a hyphen: near-misses of the short code.
    expect(payCredentialFromPath('/QP66DL4ZZ')).toBeNull();
    expect(payCredentialFromPath('/QP66DL4ZZKX')).toBeNull();
    expect(payCredentialFromPath('/QP66-L4ZZK')).toBeNull();
    expect(payCredentialFromPath('/pay/short')).toBeNull();
  });

  it('has an answer for no path at all', () => {
    expect(payCredentialFromPath(null)).toBeNull();
    expect(payCredentialFromPath(undefined)).toBeNull();
    expect(payCredentialFromPath('')).toBeNull();
  });
});
