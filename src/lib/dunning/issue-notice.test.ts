import { describe, expect, it } from 'vitest';

import { issueNoticeDecision } from './issue-notice';
import { DEFAULT_SCENARIO } from './scenario';

const TODAY = '2026-08-28';

const invoice = (over: Partial<Parameters<typeof issueNoticeDecision>[0]['invoice']> = {}) => ({
  status: 'pending' as const,
  due_date: '2026-09-15',
  automation_enabled: true,
  scenario_mode: 'default' as const,
  issue_notice_sent_at: null,
  ...over,
});

const decide = (over: Partial<Parameters<typeof issueNoticeDecision>[0]> = {}) =>
  issueNoticeDecision({
    invoice: invoice(),
    tenantAutomationEnabled: true,
    onIssue: { ...DEFAULT_SCENARIO.onIssue },
    today: TODAY,
    ...over,
  });

describe('whether an invoice is owed a notice', () => {
  it('sends for a fresh invoice on the default scenario', () => {
    expect(decide()).toEqual({ send: true });
  });

  it('sends on the due date itself', () => {
    // Raised and due the same day is unusual but legitimate, and the customer
    // has more reason to hear about it, not less.
    expect(decide({ invoice: invoice({ due_date: TODAY }) })).toEqual({ send: true });
  });
});

describe('when it stays quiet', () => {
  it('never sends twice', () => {
    const already = invoice({ issue_notice_sent_at: '2026-08-27T09:00:00Z' });
    expect(decide({ invoice: already })).toEqual({ send: false, reason: 'already sent' });
  });

  it('says nothing about an invoice that is already past its due date', () => {
    // Importing a backlog is the common case. "Your invoice has been issued" is
    // false for a debt that has been outstanding for a month, and the ladder is
    // where it belongs.
    const old = invoice({ due_date: '2026-07-01' });
    expect(decide({ invoice: old })).toEqual({ send: false, reason: 'already past its due date' });
  });

  it('respects the switch on the invoice, in either of its two forms', () => {
    expect(decide({ invoice: invoice({ scenario_mode: 'off' }) })).toEqual({
      send: false,
      reason: 'automation off for this invoice',
    });
    expect(decide({ invoice: invoice({ automation_enabled: false }) })).toEqual({
      send: false,
      reason: 'automation off for this invoice',
    });
  });

  it('respects the tenant switch', () => {
    // The master switch is what stands between a half-configured account and a
    // customer receiving mail nobody meant to send.
    expect(decide({ tenantAutomationEnabled: false })).toEqual({
      send: false,
      reason: 'automation off for the tenant',
    });
  });

  it('respects the notice being switched off in the scenario', () => {
    expect(decide({ onIssue: { enabled: false, channels: ['email'] } })).toEqual({
      send: false,
      reason: 'notice on issue is switched off',
    });
  });

  it('treats a notice with no channel as switched off', () => {
    expect(decide({ onIssue: { enabled: true, channels: [] } })).toEqual({
      send: false,
      reason: 'no channel',
    });
  });

  it('says nothing about an invoice that is no longer open', () => {
    for (const status of ['paid', 'cancelled', 'written_off'] as const) {
      expect(decide({ invoice: invoice({ status }) })).toEqual({
        send: false,
        reason: 'invoice not open',
      });
    }
  });
});

describe('the order the reasons are given in', () => {
  it('reports having already sent before anything else', () => {
    // Every other reason describes something to fix. This one describes
    // something that already happened, and a caller retrying needs to know that
    // first — otherwise a paid invoice reads as "not open" and invites a resend.
    const sentAndPaid = invoice({ issue_notice_sent_at: '2026-08-27T09:00:00Z', status: 'paid' });
    expect(decide({ invoice: sentAndPaid })).toEqual({ send: false, reason: 'already sent' });
  });
});
