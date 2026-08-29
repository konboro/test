/**
 * When rent falls due, as arithmetic on calendar dates.
 *
 * Deliberately free of the database and of the clock: every function takes the
 * day it should treat as today. Rent generation is the one part of this product
 * that creates debts nobody typed, so the rule that decides whether a charge
 * exists has to be readable and testable on its own — a bug here does not show
 * up as a broken screen, it shows up as a tenant being chased for a month that
 * never happened.
 *
 * Dates are `YYYY-MM-DD` strings throughout, compared lexicographically, which
 * is exact for that format and immune to the timezone mistakes that date
 * objects invite.
 */

export interface LeaseSchedule {
  /** 1–31. Clamped to the month's last day, so "the 31st" works in February. */
  dueDay: number;
  startsOn: string;
  endsOn: string | null;
  /** The earliest month this lease may bill for. */
  generateFrom: string;
  active: boolean;
}

/**
 * How far back a lease will ever reach for unbilled rent.
 *
 * `generate_from` defaults to the month the lease was entered, so reaching this
 * means somebody deliberately backdated — or mistyped — a date. Two years of
 * arrears is a lot to bill at once; two hundred is a typo, and this is what
 * stops a slipped keystroke from opening a hundred ladders against one tenant.
 *
 * It is a WINDOW, not a count, and that distinction is the whole of a bug this
 * had. Capping the count truncated from the oldest period, so once the first
 * twenty-four existed every later run returned the same twenty-four, all of
 * them already billed — and the lease silently stopped producing rent forever.
 * A window ending at today always contains today, so the current month is
 * always offered however far back the start was set.
 */
export const MAX_BACKFILL_MONTHS = 24;

/** @deprecated The cap is a window now. Kept so an old import still compiles. */
export const MAX_PERIODS_PER_RUN = MAX_BACKFILL_MONTHS;

/** `YYYY-MM` for a date string. */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

// Sliced rather than split-and-destructured: the format is fixed, and under
// `noUncheckedIndexedAccess` an index into a split array is possibly undefined,
// which is a true statement about arrays and a false one about `YYYY-MM`.
function yearOf(period: string): number {
  return Number(period.slice(0, 4));
}

function monthOf(period: string): number {
  return Number(period.slice(5, 7));
}

function daysInMonth(period: string): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(yearOf(period), monthOf(period), 0)).getUTCDate();
}

function addMonth(period: string): string {
  const year = yearOf(period);
  const month = monthOf(period);

  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** `period` moved by `months`, which may be negative. */
function shiftMonths(period: string, months: number): string {
  const index = yearOf(period) * 12 + (monthOf(period) - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;

  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The day rent falls due in a given month.
 *
 * A lease that says "the 31st" is due on the 28th of February — which is what
 * every landlord means and what no lease writes down. Clamping is the only
 * behaviour that does not either skip a month or spill into the next one.
 */
export function chargeDate(period: string, dueDay: number): string {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

/**
 * Every period whose rent is due by `today` and has not been ruled out.
 *
 * Four things rule a period out, and each is a real case rather than a guard
 * against nothing:
 *
 *  - the charge date has not arrived yet — rent due on the 5th is not owed on
 *    the 3rd, however much the month has started;
 *  - it falls before the lease began, which is what happens in the first month
 *    of a tenancy that starts on the 20th with rent due on the 5th;
 *  - it falls before `generateFrom`, the line the landlord drew when they said
 *    "take over from here";
 *  - it falls after the lease ended.
 */
export function periodsDue(lease: LeaseSchedule, today: string): string[] {
  if (!lease.active) return [];

  const asked = periodOf(lease.startsOn > lease.generateFrom ? lease.startsOn : lease.generateFrom);
  const last = periodOf(today);

  // The window, anchored on today rather than on the lease. Anchoring it on the
  // lease is what used to make a backdated one stop billing altogether.
  const earliest = shiftMonths(last, -(MAX_BACKFILL_MONTHS - 1));
  const first = asked > earliest ? asked : earliest;

  const periods: string[] = [];

  for (let period = first; period <= last; period = addMonth(period)) {
    const due = chargeDate(period, lease.dueDay);

    if (due > today) continue;
    if (due < lease.startsOn) continue;
    if (due < lease.generateFrom) continue;
    if (lease.endsOn && due > lease.endsOn) break;

    periods.push(period);
  }

  return periods;
}

/**
 * The next date rent falls due, for the screen that says so.
 *
 * Includes today: a landlord opening the app on the 1st should read "due today",
 * not next month's date.
 */
export function nextChargeDate(lease: LeaseSchedule, today: string): string | null {
  if (!lease.active) return null;

  const floor = [today, lease.startsOn, lease.generateFrom].sort().at(-1) as string;

  let period = periodOf(floor);

  // Two candidates are enough: if this month's day has passed, the next month's
  // has not, whatever the clamping did.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const due = chargeDate(period, lease.dueDay);

    if (due >= floor) {
      if (lease.endsOn && due > lease.endsOn) return null;
      return due;
    }

    period = addMonth(period);
  }

  return null;
}

/** The reference that makes generating a period twice a no-op. */
export function chargeReference(leaseId: string, period: string): string {
  return `lease:${leaseId}:${period}`;
}
