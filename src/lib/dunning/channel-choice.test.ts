import { describe, expect, it } from 'vitest';

import { narrowChannels } from './manual';

/**
 * The operator picks a channel for reasons the system cannot see — SMS to
 * someone who never opens mail, email only for a customer who complained about
 * texts. What it must never do is force a channel that is not there.
 */
describe('narrowChannels', () => {
  it('sends on everything available when nothing is narrowed', () => {
    expect(narrowChannels(['email', 'sms'], 'both')).toEqual(['email', 'sms']);
  });

  it('keeps only the chosen channel', () => {
    expect(narrowChannels(['email', 'sms'], 'email')).toEqual(['email']);
    expect(narrowChannels(['email', 'sms'], 'sms')).toEqual(['sms']);
  });

  it('cannot conjure a channel that is unavailable', () => {
    // A debtor with no phone stays unreachable by SMS however it is asked for.
    // The caller reports this as nothing sent, which is the honest outcome.
    expect(narrowChannels(['email'], 'sms')).toEqual([]);
    expect(narrowChannels([], 'email')).toEqual([]);
  });

  it('leaves a single available channel alone when it is the one chosen', () => {
    expect(narrowChannels(['sms'], 'sms')).toEqual(['sms']);
  });
});
