/**
 * CSRF protection for the Stripe Connect handshake.
 *
 * Stripe hands the `state` parameter back verbatim on return from the OAuth
 * screen. Signing it binds the round trip to one tenant and one 15-minute
 * window, so a link crafted by someone else cannot attach *their* Stripe account
 * to *this* tenant — which would silently redirect that tenant's collections to
 * an attacker's balance.
 *
 * The callback additionally checks the signed-in user matches the state. Both
 * are needed: the signature stops forgery, the session check stops a valid state
 * being replayed against a different logged-in account.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { requireEnv } from '@/lib/env';

const TTL_MS = 15 * 60 * 1000;

function mac(payload: string): string {
  // Reuses the application key rather than adding another secret to lose.
  return createHmac('sha256', requireEnv('ENCRYPTION_KEY')).update(payload).digest('base64url');
}

export function signConnectState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyConnectState(state: string, userId: string): boolean {
  const parts = state.split('.');
  const [stateUserId, issuedAt, signature] = parts;

  if (parts.length !== 3 || !stateUserId || !issuedAt || !signature) return false;

  const expected = mac(`${stateUserId}.${issuedAt}`);

  const given = Buffer.from(signature, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;

  const issued = Number.parseInt(issuedAt, 10);
  if (!Number.isFinite(issued) || Date.now() - issued > TTL_MS) return false;

  return stateUserId === userId;
}
