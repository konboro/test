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

/** A sentence, not a case file — it has to fit beside the date on a list row. */
export const MAX_SNOOZE_NOTE = 140;

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

/**
 * What one submission of the pause dialog means, as a date or as nothing.
 *
 * The dialog posts every field it has, so the three buttons all arrive with
 * the date input's current value attached — and "resume now" with yesterday's
 * promise still in the box used to re-save that promise instead of lifting it.
 * The precedence is therefore explicit and lives here, next to the rules it
 * enforces, rather than being implied by the order of a ternary in the action:
 *
 *   1. resume wins over everything — it is the operator saying "stop";
 *   2. a preset wins over the date field, because pressing "7 days" while a
 *      pause is running is a request to change it, not to confirm the old one;
 *   3. otherwise the typed date, validated.
 */
export function resolveSnooze(
  request: { resume?: boolean; days?: string | number | null; until?: string | null },
  today: string,
): string | null {
  if (request.resume) return null;

  const days = Number(request.days ?? '');
  if (Number.isFinite(days) && days > 0) return snoozeUntil(today, days);

  const until = String(request.until ?? '').trim();
  return until ? normaliseSnoozeDate(until, today) : null;
}

/**
 * The note as it should be stored: one tidy line, or nothing.
 *
 * Trimmed and collapsed because it is typed in a hurry and pasted from
 * elsewhere, and bounded because it is rendered on a list row next to the date
 * — a wall of text there hides the thing the row exists to show.
 */
export function normaliseSnoozeNote(value: string | null | undefined): string | null {
  const note = (value ?? '').replace(/\s+/g, ' ').trim();
  return note ? note.slice(0, MAX_SNOOZE_NOTE) : null;
}

/** Validates a date typed into the form: a real day, today or later, in range. */
export function normaliseSnoozeDate(value: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value < today) return null;

  const limit = snoozeUntil(today, MAX_SNOOZE_DAYS);
  if (limit && value > limit) return null;

  return value;
}
