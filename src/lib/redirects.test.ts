import { describe, expect, it } from 'vitest';

import { safeNextPath } from './redirects';

describe('safeNextPath', () => {
  it('follows an ordinary same-site path', () => {
    expect(safeNextPath('/invoices')).toBe('/invoices');
    expect(safeNextPath('/settings#credits')).toBe('/settings#credits');
  });

  it('falls back on absolute and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example/phish')).toBe('/dashboard');
  });

  it('falls back on the backslash variant browsers normalise to a slash', () => {
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
  });

  it('falls back on non-strings and relative paths', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath(undefined)).toBe('/dashboard');
    expect(safeNextPath('dashboard')).toBe('/dashboard');
    expect(safeNextPath('')).toBe('/dashboard');
  });
});
