import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signConnectState, verifyConnectState } from './stripe-connect';

const ALICE = '11111111-1111-1111-1111-111111111111';
const MALLORY = '22222222-2222-2222-2222-222222222222';

describe('connect state', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('accepts a state it just issued for the same tenant', () => {
    expect(verifyConnectState(signConnectState(ALICE), ALICE)).toBe(true);
  });

  it('refuses a state issued for a different tenant', () => {
    // The attack this stops: Mallory starts a handshake, sends Alice the
    // resulting link, and Alice's collections get pointed at Mallory's Stripe
    // account.
    expect(verifyConnectState(signConnectState(MALLORY), ALICE)).toBe(false);
  });

  it('refuses a state whose tenant id was swapped', () => {
    const state = signConnectState(MALLORY);
    const forged = state.replace(MALLORY, ALICE);

    expect(forged).not.toBe(state);
    expect(verifyConnectState(forged, ALICE)).toBe(false);
  });

  it('refuses a tampered signature', () => {
    const state = signConnectState(ALICE);
    const parts = state.split('.');

    expect(verifyConnectState(`${parts[0]}.${parts[1]}.deadbeef`, ALICE)).toBe(false);
  });

  it('refuses malformed input rather than throwing', () => {
    expect(verifyConnectState('', ALICE)).toBe(false);
    expect(verifyConnectState('nonsense', ALICE)).toBe(false);
    expect(verifyConnectState(`${ALICE}.123`, ALICE)).toBe(false);
  });

  it('expires after fifteen minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T10:00:00Z'));
    const state = signConnectState(ALICE);

    vi.setSystemTime(new Date('2026-08-15T10:14:00Z'));
    expect(verifyConnectState(state, ALICE)).toBe(true);

    vi.setSystemTime(new Date('2026-08-15T10:16:00Z'));
    expect(verifyConnectState(state, ALICE)).toBe(false);
  });

  it('cannot be verified with a different application key', () => {
    const state = signConnectState(ALICE);

    vi.stubEnv('ENCRYPTION_KEY', 'b3RoZXJrZXlvdGhlcmtleW90aGVya2V5b3RoZXJrZXk=');
    expect(verifyConnectState(state, ALICE)).toBe(false);
  });
});
