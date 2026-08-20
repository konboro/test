import { describe, expect, it } from 'vitest';

import { joinFailure } from './join';

describe('joinFailure', () => {
  // The strings are what `accept_invite` raises. Each one leaves the person
  // holding the link with a different next step, and collapsing them into one
  // "could not join" would hide which.
  it('separates the four refusals', () => {
    expect(joinFailure('invitation not found')).toBe('notFound');
    expect(joinFailure('invitation already used')).toBe('used');
    expect(joinFailure('invitation expired')).toBe('expired');
    expect(joinFailure('invitation is for a different email address')).toBe('wrongEmail');
  });

  it('survives the wrapping postgrest puts around them', () => {
    expect(joinFailure('P0001: invitation expired')).toBe('expired');
  });

  it('falls back on anything it does not recognise', () => {
    expect(joinFailure('connection reset')).toBe('failed');
    expect(joinFailure('')).toBe('failed');
    expect(joinFailure(null)).toBe('failed');
    expect(joinFailure(undefined)).toBe('failed');
  });
});
