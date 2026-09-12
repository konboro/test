import { describe, expect, it } from 'vitest';

// `CommChannel` is the database's name for it; `Channel` exists only as the
// scenario module's alias, which is not importable from here without pulling
// the engine into a test that deliberately runs without one.
import type { CommChannel as Channel } from '@/types/database';

import { enabledChannels as allowed } from './channel-policy';

/**
 * The account-wide channel switches.
 *
 * `dispatchContact` narrows the step's channels by them, and every send in the
 * product goes through that function — the nightly sweep, the notice when an
 * invoice is raised, and the button an operator presses. This is the rule it
 * applies, and so does the engine before it claims a contact row — which is
 * the point that matters: applied only at delivery, the step was claimed, nothing
 * went out, and it was retried on every run.
 *
 * Written as the same expression dispatch uses. If that changes, this fails,
 * which is the point: a switch that stops meaning anything on one of the three
 * paths is the failure worth catching.
 */
const both: Channel[] = ['email', 'sms'];

describe('narrowing a step to the account’s channels', () => {
  it('leaves a step alone when both channels are on', () => {
    expect(allowed(both, { email_enabled: true, sms_enabled: true })).toEqual(['email', 'sms']);
  });

  it('drops the channel that was switched off', () => {
    expect(allowed(both, { email_enabled: true, sms_enabled: false })).toEqual(['email']);
    expect(allowed(both, { email_enabled: false, sms_enabled: true })).toEqual(['sms']);
  });

  it('leaves nothing to send when both are off', () => {
    // Not an error: the operator said no to both. The send simply has no channel
    // and the step is reported as skipped rather than failed.
    expect(allowed(both, { email_enabled: false, sms_enabled: false })).toEqual([]);
  });

  it('never adds a channel the step did not ask for', () => {
    // The switch is a veto, not a grant. The pre-due step is email-only by
    // design, and switching SMS on at the account level must not change that.
    expect(allowed(['email'], { email_enabled: true, sms_enabled: true })).toEqual(['email']);
  });

  it('treats an account that has never been asked as a yes', () => {
    // The columns default to true, and a row read before the migration landed
    // has neither. Undefined must not silently stop every message.
    expect(allowed(both, {})).toEqual(['email', 'sms']);
    expect(allowed(both, { email_enabled: undefined, sms_enabled: undefined })).toEqual([
      'email',
      'sms',
    ]);
  });

  it('only ever removes, so the order the scenario chose survives', () => {
    for (const tenant of [
      { email_enabled: true, sms_enabled: true },
      { email_enabled: true, sms_enabled: false },
      { email_enabled: false, sms_enabled: true },
      { email_enabled: false, sms_enabled: false },
    ]) {
      const out = allowed(both, tenant);

      expect(out.length).toBeLessThanOrEqual(both.length);
      expect(out).toEqual(both.filter((c) => out.includes(c)));
    }
  });
});
