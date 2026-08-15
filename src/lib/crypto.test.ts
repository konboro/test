import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, safeEqual } from './crypto';

const original = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

afterAll(() => {
  process.env.ENCRYPTION_KEY = original;
});

describe('secret encryption', () => {
  it('round-trips a myDATA subscription key', () => {
    const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(decryptSecret(encryptSecret(key))).toBe(key);
  });

  it('handles non-ASCII input', () => {
    const value = 'κλειδί-δοκιμής-ΑΑΔΕ';
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per call, so identical keys are not recognisable as identical
    // in the database.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('emits the versioned four-part format', () => {
    expect(encryptSecret('x').split(':')).toHaveLength(4);
    expect(encryptSecret('x').startsWith('v1:')).toBe(true);
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const payload = encryptSecret('sensitive');
    const parts = payload.split(':');
    // Flip the last character of the ciphertext; GCM's auth tag must catch it.
    const data = parts[3]!;
    parts[3] = data.slice(0, -1) + (data.at(-1) === 'A' ? 'B' : 'A');

    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-encrypted')).toThrow('Malformed encrypted payload');
    expect(() => decryptSecret('v2:a:b:c')).toThrow('Malformed encrypted payload');
  });

  it('refuses a key of the wrong length', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = saved;
  });
});

describe('safeEqual', () => {
  it('matches identical secrets', () => {
    expect(safeEqual('token', 'token')).toBe(true);
  });

  it('rejects different secrets and differing lengths', () => {
    expect(safeEqual('token', 'other')).toBe(false);
    expect(safeEqual('token', 'token-longer')).toBe(false);
  });
});

