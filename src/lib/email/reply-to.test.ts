import { describe, expect, it } from 'vitest';

import { replyToFor } from './reply-to';

describe('where a reply lands', () => {
  it('uses the address the tenant chose', () => {
    expect(replyToFor({ reply_to_email: 'money@acme.gr', email: 'owner@acme.gr' })).toBe(
      'money@acme.gr',
    );
  });

  it('falls back to the account address rather than sending none', () => {
    // The bug this pins is silent: with no Reply-To the debtor answers noreply@
    // on our own domain, and nobody ever learns they replied.
    expect(replyToFor({ reply_to_email: null, email: 'owner@acme.gr' })).toBe('owner@acme.gr');
    expect(replyToFor({ reply_to_email: '   ', email: 'owner@acme.gr' })).toBe('owner@acme.gr');
  });

  it('returns nothing only when there is genuinely no address', () => {
    expect(replyToFor({})).toBeUndefined();
    expect(replyToFor({ reply_to_email: '', email: '' })).toBeUndefined();
  });
});
