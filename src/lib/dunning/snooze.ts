/**
 * Holding reminders until a date.
 *
 * A customer says "I'll pay on the 15th". Until the 16th they hear nothing —
 * not from the nightly sweep and not from the reminder button, because a
 * promise made to a person is not kept by a system that only half-respects it.
 *
 * Pure and date-only on purpose: the whole rule is one comparison, and it is
 * the same comparison everywhere it matters. Dates are ISO calendar days in the
 * tenant's timezone, exactly like `contact_on` and the ladder's arithmetic.
 */

/** How long a snooze may run. Longer than this is a mute, and should say so. */
export const MAX_SNOOZE_DAYS = 180;

/** The presets the UI offers, in days. A custom date is always allowed too. */
export const SNOOZE_PRESETS = [7, 14, 30] as const;

/**
 * True while the debtor is snoozed.
 *
 * The snooze covers its end date — "until the 15th" is kept by staying quiet
 * on the 15th and resuming on the 16th, which is how the promise was meant.
 */
export function isSnoozed(
  debtor: { snoozed_until?: string | null },
  today: string,
): boolean {
  const until = debtor.snoozed_until;
  return Boolean(until) && (until as string) >= today;
}

/** Whole days from today until the snooze lifts; 0 when it lifts today. */
export function snoozeDaysLeft(
  debtor: { snoozed_until?: string | null },
  today: string,
): number | null {
  if (!isSnoozed(debtor, today)) return null;

  const until = new Date(`${debtor.snoozed_until as string}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((until - now) / 86_400_000);
}

/**
 * The date a snooze of `days` from `today` ends, or null when the request is
 * not a snooze at all.
 *
 * Bounded rather than trusted: the value arrives from a form, and an unbounded
 * pause is a mute wearing a date.
 */
export function snoozeUntil(today: string, days: number): string | null {
  if (!Number.isFinite(days) || days < 1 || days > MAX_SNOOZE_DAYS) return null;

  const end = new Date(`${today}T00:00:00Z`);
  // Inclusive of the end date: `isSnoozed` stays true through it, so "7 days"
  // means seven quiet days and the reminder resumes on the eighth.
  end.setUTCDate(end.getUTCDate() + days - 1);
  return end.toISOString().slice(0, 10);
}

/** Validates a date typed into the form: a real day, today or later, in range. */
export function normaliseSnoozeDate(value: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value < today) return null;

  const limit = snoozeUntil(today, MAX_SNOOZE_DAYS);
  if (limit && value > limit) return null;

  return value;
}
