import { describe, expect, it } from 'vitest';

import { notificationRecipients } from './notify';

describe('who is told that a payment arrived', () => {
  it('tells the account holder even when a reply-to is set', () => {
    // The bug this pins: a payment notice went only to reply-to, so setting a
    // shared inbox for debtor replies silently stopped the owner being told
    // about their own money.
    expect(
      notificationRecipients({ email: 'owner@example.com', reply_to_email: 'info@example.com' }),
    ).toEqual(['owner@example.com', 'info@example.com']);
  });

  it('sends one copy when both addresses are the same', () => {
    expect(
      notificationRecipients({ email: 'owner@example.com', reply_to_email: 'Owner@Example.com' }),
    ).toEqual(['owner@example.com']);
  });

  it('falls back to whichever address exists', () => {
    expect(notificationRecipients({ email: 'owner@example.com' })).toEqual(['owner@example.com']);
    expect(notificationRecipients({ reply_to_email: 'info@example.com' })).toEqual([
      'info@example.com',
    ]);
  });

  it('has nobody to tell when neither is set', () => {
    expect(notificationRecipients({})).toEqual([]);
    expect(notificationRecipients({ email: '  ', reply_to_email: null })).toEqual([]);
  });
});
