import { describe, expect, it } from 'vitest';

import {
  chargeDate,
  chargeReference,
  MAX_PERIODS_PER_RUN,
  nextChargeDate,
  periodsDue,
  type LeaseSchedule,
} from './schedule';

const lease = (over: Partial<LeaseSchedule> = {}): LeaseSchedule => ({
  dueDay: 5,
  startsOn: '2026-01-01',
  endsOn: null,
  generateFrom: '2026-01-01',
  active: true,
  ...over,
});

describe('chargeDate', () => {
  it('uses the agreed day when the month has one', () => {
    expect(chargeDate('2026-03', 5)).toBe('2026-03-05');
    expect(chargeDate('2026-03', 31)).toBe('2026-03-31');
  });

  it('clamps to the last day of a short month', () => {
    // What "rent on the 31st" means in February, and what no lease spells out.
    expect(chargeDate('2026-02', 31)).toBe('2026-02-28');
    expect(chargeDate('2026-04', 31)).toBe('2026-04-30');
  });

  it('clamps in a leap February', () => {
    expect(chargeDate('2028-02', 30)).toBe('2028-02-29');
  });
});

describe('periodsDue', () => {
  it('bills the month once the day has arrived', () => {
    expect(periodsDue(lease(), '2026-01-05')).toEqual(['2026-01']);
  });

  it('does not bill before the day', () => {
    // The month has started; the rent has not been earned by the 3rd.
    expect(periodsDue(lease(), '2026-01-04')).toEqual([]);
  });

  it('catches up every month a run was missed', () => {
    expect(periodsDue(lease(), '2026-04-10')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });

  it('skips the first month when the tenancy starts after the rent day', () => {
    // Moved in on the 20th, rent due on the 5th: the first charge is next month,
    // not one dated before they had the keys.
    const first = lease({ startsOn: '2026-01-20', generateFrom: '2026-01-20' });
    expect(periodsDue(first, '2026-02-05')).toEqual(['2026-02']);
  });

  it('never bills before the line the landlord drew', () => {
    // A tenancy running since 2023, entered today. The product takes over now;
    // it does not invent three years of arrears and start chasing them.
    const old = lease({ startsOn: '2023-06-01', generateFrom: '2026-08-01' });
    expect(periodsDue(old, '2026-08-05')).toEqual(['2026-08']);
  });

  it('stops at the end of the lease', () => {
    const ending = lease({ endsOn: '2026-02-28' });
    expect(periodsDue(ending, '2026-05-10')).toEqual(['2026-01', '2026-02']);
  });

  it('bills nothing for an inactive lease', () => {
    expect(periodsDue(lease({ active: false }), '2026-06-10')).toEqual([]);
  });

  it('refuses to open more ladders than a mistyped date deserves', () => {
    const ancient = lease({ startsOn: '2000-01-01', generateFrom: '2000-01-01' });
    expect(periodsDue(ancient, '2026-08-10')).toHaveLength(MAX_PERIODS_PER_RUN);
  });
});

describe('nextChargeDate', () => {
  it('says today when rent falls due today', () => {
    expect(nextChargeDate(lease(), '2026-03-05')).toBe('2026-03-05');
  });

  it('moves to next month once the day has passed', () => {
    expect(nextChargeDate(lease(), '2026-03-06')).toBe('2026-04-05');
  });

  it('clamps the next one too', () => {
    expect(nextChargeDate(lease({ dueDay: 31 }), '2026-02-01')).toBe('2026-02-28');
  });

  it('waits for a tenancy that has not begun', () => {
    expect(nextChargeDate(lease({ startsOn: '2026-09-01' }), '2026-06-10')).toBe('2026-09-05');
  });

  it('is nothing once the lease is over', () => {
    expect(nextChargeDate(lease({ endsOn: '2026-02-28' }), '2026-03-01')).toBeNull();
    expect(nextChargeDate(lease({ active: false }), '2026-01-01')).toBeNull();
  });
});

describe('chargeReference', () => {
  it('is stable for a lease and a month, which is what makes a re-run harmless', () => {
    expect(chargeReference('abc', '2026-01')).toBe('lease:abc:2026-01');
    expect(chargeReference('abc', '2026-01')).toBe(chargeReference('abc', '2026-01'));
  });
});
