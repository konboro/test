import { describe, expect, it } from 'vitest';

import { athensHour } from '@/lib/money';

import { DEFAULT_SCENARIO } from './scenario';

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
