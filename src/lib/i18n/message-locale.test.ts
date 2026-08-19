import { describe, expect, it } from 'vitest';

import {
  isMessageLocale,
  localeFromPhone,
  overridesForLocale,
  resolveDebtorLocale,
  tenantLocale,
} from './message-locale';

describe('localeFromPhone', () => {
  it('reads Greek country codes as Greek', () => {
    expect(localeFromPhone('+306912345678', 'en')).toBe('el');
    expect(localeFromPhone('00306912345678', 'en')).toBe('el');
  });

  it('looks past the formatting the book actually contains', () => {
    expect(localeFromPhone('+30 691 234 5678', 'en')).toBe('el');
    expect(localeFromPhone('(+30) 691-234-5678', 'en')).toBe('el');
  });

  it('reads other country codes as English', () => {
    expect(localeFromPhone('+49 170 1234567', 'el')).toBe('en');
    expect(localeFromPhone('+48 512 345 678', 'el')).toBe('en');
    expect(localeFromPhone('+40 721 234 567', 'el')).toBe('en');
  });

  it('leaves a number with no country code alone', () => {
    // A Thessaloniki landline written the local way. Reading the missing +30 as
    // "not Greek" would switch a Greek customer to English over formatting.
    expect(localeFromPhone('2310123456', 'el')).toBe('el');
    expect(localeFromPhone('6912345678', 'el')).toBe('el');
  });

  it('falls back when there is nothing to read', () => {
    expect(localeFromPhone(null, 'el')).toBe('el');
    expect(localeFromPhone('', 'el')).toBe('el');
    expect(localeFromPhone('   ', 'el')).toBe('el');
    expect(localeFromPhone('n/a', 'en')).toBe('en');
  });
});

describe('resolveDebtorLocale', () => {
  it('lets the operator overrule the phone number in both directions', () => {
    expect(resolveDebtorLocale({ locale: 'en', phone: '+306912345678' }, 'el')).toBe('en');
    expect(resolveDebtorLocale({ locale: 'el', phone: '+491701234567' }, 'el')).toBe('el');
  });

  it('derives when no choice was made', () => {
    expect(resolveDebtorLocale({ locale: null, phone: '+491701234567' }, 'el')).toBe('en');
    expect(resolveDebtorLocale({ phone: '+306912345678' }, 'en')).toBe('el');
  });

  it('ignores a stored value that is not a language we have', () => {
    // A locale dropped from the product must not take the reminder down with it.
    expect(resolveDebtorLocale({ locale: 'de', phone: '+306912345678' }, 'en')).toBe('el');
    expect(resolveDebtorLocale({ locale: '', phone: null }, 'el')).toBe('el');
  });
});

describe('isMessageLocale', () => {
  it('accepts only what the product has copy for', () => {
    expect(isMessageLocale('el')).toBe(true);
    expect(isMessageLocale('en')).toBe(true);
    expect(isMessageLocale('de')).toBe(false);
    expect(isMessageLocale(null)).toBe(false);
    expect(isMessageLocale(undefined)).toBe(false);
  });
});

describe('tenantLocale', () => {
  it('reads the tenant locale, defaulting to Greek', () => {
    expect(tenantLocale({ locale: 'en' })).toBe('en');
    expect(tenantLocale({ locale: 'el' })).toBe('el');
    expect(tenantLocale({ locale: null })).toBe('el');
    expect(tenantLocale({ locale: 'de' })).toBe('el');
    expect(tenantLocale({})).toBe('el');
  });
});

describe('overridesForLocale', () => {
  const overrides = { 'manual:email': { subject: 'S', body: 'B' } };

  it('uses the tenant copy for the language it was written in', () => {
    expect(overridesForLocale(overrides, 'el', 'el')).toBe(overrides);
  });

  it('withholds it from every other language', () => {
    // Otherwise a Greek override goes out to a customer being written to in
    // English, under an English subject line.
    expect(overridesForLocale(overrides, 'en', 'el')).toEqual({});
  });
});
