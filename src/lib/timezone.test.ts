import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEZONE, athensDate, isTimezone, zonedDate, zonedHour } from './money';

/** 01:30 UTC — the hour where the calendar day differs across most of Europe. */
const NIGHT = new Date('2026-08-28T01:30:00Z');

describe('recognising a timezone', () => {
  it('accepts names the runtime can actually use', () => {
    expect(isTimezone('Europe/Athens')).toBe(true);
    expect(isTimezone('Europe/Warsaw')).toBe(true);
    expect(isTimezone('UTC')).toBe(true);
  });

  it('rejects anything it cannot format with', () => {
    // A plausible-looking name stored happily would fall back silently on every
    // date the product prints, which is the hardest kind of wrong to notice.
    expect(isTimezone('Europe/Atlantis')).toBe(false);
    expect(isTimezone('')).toBe(false);
    expect(isTimezone(null)).toBe(false);
    expect(isTimezone(42)).toBe(false);
  });
});

describe('the calendar day', () => {
  it('differs by zone at the same instant', () => {
    // 01:30 UTC is already the 28th in Athens and still the 28th in Warsaw, but
    // the 27th in New York. Which day an invoice is late on depends on this.
    expect(zonedDate('Europe/Athens', NIGHT)).toBe('2026-08-28');
    expect(zonedDate('America/New_York', NIGHT)).toBe('2026-08-27');
  });

  it('falls back rather than throwing on a name it cannot use', () => {
    expect(zonedDate('Europe/Atlantis', NIGHT)).toBe(zonedDate(DEFAULT_TIMEZONE, NIGHT));
  });

  it('keeps the old helper answering for Athens', () => {
    expect(athensDate(NIGHT)).toBe(zonedDate('Europe/Athens', NIGHT));
  });
});

describe('the local hour', () => {
  it('is what the sending hour is compared against', () => {
    // Athens is two hours ahead of Warsaw in summer. A tenant who chose nine
    // means nine where they are, which is the whole reason this is not UTC.
    expect(zonedHour('Europe/Athens', NIGHT)).toBe(4);
    expect(zonedHour('Europe/Warsaw', NIGHT)).toBe(3);
    expect(zonedHour('UTC', NIGHT)).toBe(1);
  });

  it('falls back rather than throwing', () => {
    expect(zonedHour('Nowhere/Real', NIGHT)).toBe(zonedHour(DEFAULT_TIMEZONE, NIGHT));
  });
});
