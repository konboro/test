/** Money is handled in integer minor units everywhere. Never use floats for totals. */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function formatMoney(cents: number, currency = 'EUR', locale = 'el-GR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/** Whole days from `from` to `to`, computed on UTC calendar dates. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === 'string' ? new Date(`${from}T00:00:00Z`) : from;
  const b = typeof to === 'string' ? new Date(`${to}T00:00:00Z`) : to;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
      Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) /
      dayMs,
  );
}

/** `YYYY-MM-DD` for the given instant in Europe/Athens, the operative timezone. */
export function athensDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A calendar day, from either a `date` or a `timestamptz`.
 *
 * The two are mixed across the schema — due dates are dates, memberships and
 * invitations are timestamps — and appending a time to a value that already
 * carried one produced an Invalid Date, which is a crashed page rather than a
 * wrong-looking one. Taking the leading day makes both work and neither shift.
 */
export function formatDate(isoDate: string, locale = 'el-GR'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
}

/**
 * The hour, 0–23, for the given instant in Europe/Athens.
 *
 * The scenario's send hour is a local hour, and it has to stay local: a cron
 * firing at a fixed UTC time lands at 09:00 Athens in winter and 10:00 in
 * summer, so a tenant who chose "morning" would silently be moved an hour twice
 * a year. Reading the local hour is what makes the choice mean what it says.
 */
export function athensHour(at: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).format(at);

  return Number(hour);
}
