import { zonedDate } from '@/lib/money';

/**
 * Whether a debtor has already been written to today, according to what was
 * actually sent.
 *
 * The guarantee has always been the claim on `dunning_contacts`: one row per
 * debtor per calendar day, enforced by a unique index. That is sound until the
 * testing flag turns the claim off, at which point there is no guard *and no
 * trace* — fifty customers were written to with nothing recorded, and one of
 * them twice, and afterwards the database could not say who had been contacted.
 *
 * So this asks the send log instead. It records what actually left the building,
 * which is true whether or not a claim was made, and it stays true for messages
 * sent before this check existed.
 */

export interface SentRecord {
  /** ISO timestamp from `communications_log.sent_at`. */
  sent_at: string;
}

/**
 * Pure, so the rule can be tested without a database.
 *
 * `today` and the zone are passed in rather than read from the clock: which
 * calendar day a message belongs to depends on where the tenant is, and a test
 * that depends on when it runs is a test that fails at midnight.
 */
export function contactedOn(
  rows: ReadonlyArray<SentRecord>,
  timezone: string,
  today: string,
): boolean {
  return rows.some((row) => {
    const at = new Date(row.sent_at);
    return !Number.isNaN(at.getTime()) && zonedDate(timezone, at) === today;
  });
}

/** How far back to look. A day and a half covers every timezone we run in. */
export const LOOKBACK_HOURS = 36;
