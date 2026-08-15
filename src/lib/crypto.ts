import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { requireEnv } from '@/lib/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

function key(): Buffer {
  const raw = requireEnv('ENCRYPTION_KEY');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32',
    );
  }
  return buf;
}

/**
 * Encrypts a secret for storage at rest.
 *
 * Output format: `v1:<iv>:<authTag>:<ciphertext>`, each part base64. The version
 * prefix means the key or algorithm can be rotated later without ambiguity about
 * how an existing row was encrypted.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted payload');
  }

  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time comparison for shared secrets (cron bearer token, etc.). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
