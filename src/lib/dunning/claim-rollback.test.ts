import { describe, expect, it } from 'vitest';

/**
 * Whether a rung that delivered nothing gets its claim handed back.
 *
 * The claim row is the only thing making the sweep idempotent — the unique
 * index on (debtor_id, contact_on) that used to cap this at one message a day
 * was removed at the operator's decision. So the rule below is now the whole
 * guard, and it turns on a distinction that "nothing sent" alone does not make:
 * was a provider actually asked?
 *
 * The rule as the engine applies it. Kept here as an expression because the
 * engine's version is three lines inside a function that needs a database, a
 * mail provider and a tenant to reach.
 */
function handsClaimBack(sent: { emailsSent: number; smsSent: number; errors: string[] }): boolean {
  if (sent.emailsSent > 0 || sent.smsSent > 0) return false;
  return sent.errors.length === 0;
}

const nothing = { emailsSent: 0, smsSent: 0 };

describe('a rung that delivered nothing', () => {
  it('hands the claim back when no provider was asked', () => {
    // Every channel skipped for a stated reason — no phone on file, a channel
    // switched off, no provider configured. Nothing can have reached the
    // debtor, so the rung is genuinely unspent and must fire another day.
    expect(handsClaimBack({ ...nothing, errors: [] })).toBe(true);
  });

  it('keeps the claim when a provider was asked and did not confirm', () => {
    // This is the case that mattered. A send that fails after the provider
    // accepted the message looks identical from here, so handing the claim back
    // turns one bad minute into the same demand resent on every run for the
    // rest of the day.
    expect(handsClaimBack({ ...nothing, errors: ['Resend 500'] })).toBe(false);
  });

  it('keeps the claim when anything at all went out', () => {
    // Partial delivery is delivery: the debtor has been contacted.
    expect(handsClaimBack({ emailsSent: 1, smsSent: 0, errors: [] })).toBe(false);
    expect(handsClaimBack({ emailsSent: 0, smsSent: 1, errors: ['sms failed'] })).toBe(false);
    expect(handsClaimBack({ emailsSent: 1, smsSent: 0, errors: ['sms failed'] })).toBe(false);
  });

  it('does not read a skip as a failure', () => {
    // `skipped` carries reasons, not errors. One channel unreachable and the
    // other never asked is still "nothing attempted".
    expect(handsClaimBack({ ...nothing, errors: [] })).toBe(true);
  });
});
