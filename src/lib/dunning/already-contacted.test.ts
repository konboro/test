import { describe, expect, it } from 'vitest';

import { contactedOn } from './already-contacted';

const ATHENS = 'Europe/Athens';

/**
 * The rule that stops somebody being written to twice in a day.
 *
 * It reads the send log rather than the claim, because the claim can be turned
 * off by a flag and the log cannot. Fifty customers were written to with the
 * flag on: nothing was claimed, nothing was recorded, and afterwards the
 * database could not answer "who has already heard from us".
 */
describe('whether a debtor has already heard from us today', () => {
  it('says no when nothing was ever sent', () => {
    expect(contactedOn([], ATHENS, '2026-08-28')).toBe(false);
  });

  it('says yes for a message sent earlier the same day', () => {
    expect(contactedOn([{ sent_at: '2026-08-28T11:00:00Z' }], ATHENS, '2026-08-28')).toBe(true);
  });

  it('says no for yesterday', () => {
    expect(contactedOn([{ sent_at: '2026-08-27T11:00:00Z' }], ATHENS, '2026-08-28')).toBe(false);
  });

  it('uses the tenant calendar day, not UTC', () => {
    // 22:30 UTC is already the next day in Athens. A tenant sending late in the
    // evening would otherwise be told they had not contacted somebody they had.
    const lateEvening = [{ sent_at: '2026-08-27T22:30:00Z' }];

    expect(contactedOn(lateEvening, ATHENS, '2026-08-28')).toBe(true);
    expect(contactedOn(lateEvening, 'UTC', '2026-08-28')).toBe(false);
  });

  it('ignores a timestamp it cannot read rather than throwing', () => {
    // A send is about to go out on the strength of this answer. A bad row
    // should not take the whole batch down.
    expect(contactedOn([{ sent_at: 'not a date' }], ATHENS, '2026-08-28')).toBe(false);
  });

  it('needs only one message to have gone', () => {
    const rows = [
      { sent_at: '2026-08-26T09:00:00Z' },
      { sent_at: '2026-08-28T09:00:00Z' },
      { sent_at: '2026-08-27T09:00:00Z' },
    ];

    expect(contactedOn(rows, ATHENS, '2026-08-28')).toBe(true);
  });
});
