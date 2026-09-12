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

describe('the preference that switches the notice off', () => {
  it('is read as on unless it is explicitly false', () => {
    // The column defaults to true and the check is `=== false`, so a tenant row
    // read before the migration landed — or by a query that did not ask for the
    // column — keeps being told rather than silently going quiet.
    const off = (tenant: { notify_on_payment?: boolean | null }) =>
      tenant.notify_on_payment === false;

    expect(off({ notify_on_payment: false })).toBe(true);
    expect(off({ notify_on_payment: true })).toBe(false);
    expect(off({ notify_on_payment: null })).toBe(false);
    expect(off({})).toBe(false);
  });
});
