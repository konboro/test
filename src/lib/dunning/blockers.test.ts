import { describe, expect, it } from 'vitest';

import { sendBlockers, type BlockerInput } from './blockers';
import { DEFAULT_SCENARIO } from './scenario';

/** An invoice three days overdue that nothing is stopping. */
function clear(overrides: Partial<BlockerInput> = {}): BlockerInput {
  return {
    invoice: {
      status: 'pending',
      due_date: '2026-09-09',
      automation_enabled: true,
      scenario_mode: 'default',
    },
    debtor: { email: 'a@b.gr', phone: '+306900000000', muted: false, snoozed_until: null },
    tenant: { automation_enabled: true, email_enabled: true, sms_enabled: true, sms_credits: 10 },
    reported: false,
    smsMetered: false,
    scenario: DEFAULT_SCENARIO,
    completed: new Set(),
    today: '2026-09-12',
    ...overrides,
  };
}

const codes = (input: BlockerInput) => sendBlockers(input).map((b) => b.code);

describe('sendBlockers', () => {
  it('says nothing when nothing is wrong', () => {
    expect(sendBlockers(clear())).toEqual([]);
  });

  it('reports a settled invoice on its own', () => {
    // Everything else is true of this invoice too, and listing it would invite
    // somebody to go and unmute a customer over a debt that is already paid.
    const input = clear({
      invoice: { status: 'paid', due_date: '2026-09-09', automation_enabled: false },
      debtor: { email: null, phone: null, muted: true, snoozed_until: '2026-12-01' },
    });

    expect(codes(input)).toEqual(['settled']);
  });

  it('names the account switch, the invoice switch and the mute separately', () => {
    expect(codes(clear({ tenant: { automation_enabled: false } }))).toContain('accountOff');
    expect(
      codes(
        clear({
          invoice: { status: 'pending', due_date: '2026-09-09', automation_enabled: false },
        }),
      ),
    ).toContain('invoicePaused');
    expect(codes(clear({ debtor: { email: 'a@b.gr', phone: null, muted: true } }))).toContain(
      'muted',
    );
  });

  it('catches the invoice paused by its cadence alone', () => {
    // The drift this whole predicate exists for: the flag says go, the mode
    // says stop. A screen that read only the flag said nothing was wrong.
    const input = clear({
      invoice: {
        status: 'pending',
        due_date: '2026-09-09',
        automation_enabled: true,
        scenario_mode: 'off',
      },
    });

    expect(codes(input)).toContain('invoicePaused');
  });

  it('carries the day a snooze lifts, because that one ends by itself', () => {
    const [blocker] = sendBlockers(
      clear({
        debtor: { email: 'a@b.gr', phone: null, snoozed_until: '2026-09-20' },
      }),
    );

    expect(blocker).toEqual({ code: 'snoozed', until: '2026-09-20' });
  });

  it('says a customer is unreachable even when something else stops the send', () => {
    // Unmuting somebody with no email and no phone achieves nothing, so the
    // second reason has to be visible while the first is being fixed.
    const input = clear({
      debtor: { email: null, phone: null, muted: true },
    });

    expect(codes(input)).toEqual(expect.arrayContaining(['muted', 'unreachable']));
  });

  it('reports both channels being off', () => {
    const input = clear({
      tenant: { automation_enabled: true, email_enabled: false, sms_enabled: false },
    });

    expect(codes(input)).toContain('noChannels');
  });

  it('stays quiet about credits when SMS is not metered', () => {
    const input = clear({
      tenant: { automation_enabled: true, email_enabled: true, sms_enabled: true, sms_credits: 0 },
      smsMetered: false,
    });

    expect(codes(input)).not.toContain('noCredits');
  });

  it('says nothing is scheduled when every rung has already run', () => {
    const input = clear({
      completed: new Set(DEFAULT_SCENARIO.steps.map((step) => step.step)),
    });

    expect(codes(input)).toContain('nothingScheduled');
  });
});
