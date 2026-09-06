import { describe, expect, it } from 'vitest';

import { athensHour } from '@/lib/money';

import { DEFAULT_SCENARIO, sendWindowOpen } from './scenario';

describe('the hour the sweep is allowed to act in', () => {
  it('defaults to the start of the working day', () => {
    // Not 07:00, which is when the cron happens to fire: a reminder that lands
    // before anybody opens their inbox is buried by the time they do.
    expect(DEFAULT_SCENARIO.sendHour).toBe(9);
  });

  it('is read in Athens, not in UTC', () => {
    // Summer: Athens is UTC+3, so 06:00 UTC is 09:00 there. A gate written
    // against UTC would fire at the wrong local hour for half the year — and
    // would move by itself twice a year, which is exactly what choosing an hour
    // is supposed to stop.
    expect(athensHour(new Date('2026-07-01T06:00:00Z'))).toBe(9);

    // Winter: UTC+2, so the same local hour is one hour later in UTC.
    expect(athensHour(new Date('2026-01-15T07:00:00Z'))).toBe(9);
  });

  it('covers midnight without wrapping to 24', () => {
    expect(athensHour(new Date('2026-07-01T21:30:00Z'))).toBe(0);
    expect(athensHour(new Date('2026-01-15T22:30:00Z'))).toBe(0);
  });
});

describe('sendWindowOpen', () => {
  it('holds everything back before the chosen hour', () => {
    expect(sendWindowOpen(8, 9)).toBe(false);
    expect(sendWindowOpen(0, 9)).toBe(false);
  });

  it('opens on the hour itself', () => {
    expect(sendWindowOpen(9, 9)).toBe(true);
  });

  it('stays open for the rest of the day', () => {
    // The point of the whole rule. The sweep is called by a scheduler outside
    // this system and a scheduled call can be late or dropped; an equality gate
    // turns one dropped call into a day with no reminders at all, silently.
    // Here the nine o'clock message goes out at ten instead.
    expect(sendWindowOpen(10, 9)).toBe(true);
    expect(sendWindowOpen(23, 9)).toBe(true);
  });

  it('does not leak across midnight into the next day', () => {
    // Midnight is hour 0 of a new day, which is before nine — and the day is
    // what the once-per-debtor-per-day index is keyed on, so the message
    // belongs to the new day and waits for its hour.
    expect(sendWindowOpen(0, 9)).toBe(false);
  });

  it('lets a tenant who chose midnight send all day', () => {
    expect(sendWindowOpen(0, 0)).toBe(true);
    expect(sendWindowOpen(23, 0)).toBe(true);
  });

  it('never opens early for a tenant who chose the last hour', () => {
    expect(sendWindowOpen(22, 23)).toBe(false);
    expect(sendWindowOpen(23, 23)).toBe(true);
  });
});
