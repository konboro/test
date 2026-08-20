import { describe, expect, it } from 'vitest';

import {
  isSnoozed,
  MAX_SNOOZE_DAYS,
  normaliseSnoozeDate,
  snoozeDaysLeft,
  snoozeUntil,
} from './snooze';

const TODAY = '2026-08-20';

describe('isSnoozed', () => {
  it('is false with no date', () => {
    expect(isSnoozed({}, TODAY)).toBe(false);
    expect(isSnoozed({ snoozed_until: null }, TODAY)).toBe(false);
  });

  it('holds through the promised day and lifts the morning after', () => {
    // "I'll pay on the 20th" is kept by staying quiet on the 20th.
    expect(isSnoozed({ snoozed_until: '2026-08-20' }, TODAY)).toBe(true);
    expect(isSnoozed({ snoozed_until: '2026-08-21' }, TODAY)).toBe(true);
    expect(isSnoozed({ snoozed_until: '2026-08-19' }, TODAY)).toBe(false);
  });

  it('expires by itself — a past date needs no cleanup to stop counting', () => {
    expect(isSnoozed({ snoozed_until: '2020-01-01' }, TODAY)).toBe(false);
  });
});

describe('snoozeUntil', () => {
  it('counts the days inclusively, so seven days means seven quiet days', () => {
    expect(snoozeUntil(TODAY, 7)).toBe('2026-08-26');
    expect(isSnoozed({ snoozed_until: snoozeUntil(TODAY, 7) }, '2026-08-26')).toBe(true);
    expect(isSnoozed({ snoozed_until: snoozeUntil(TODAY, 7) }, '2026-08-27')).toBe(false);
  });

  it('crosses a month boundary', () => {
    expect(snoozeUntil('2026-08-28', 7)).toBe('2026-09-03');
  });

  it('refuses anything that is not a bounded pause', () => {
    // An unbounded pause is a mute wearing a date, and the form is reachable
    // with any payload.
    expect(snoozeUntil(TODAY, 0)).toBeNull();
    expect(snoozeUntil(TODAY, -5)).toBeNull();
    expect(snoozeUntil(TODAY, MAX_SNOOZE_DAYS + 1)).toBeNull();
    expect(snoozeUntil(TODAY, Number.NaN)).toBeNull();
  });
});

describe('normaliseSnoozeDate', () => {
  it('accepts today and any day inside the limit', () => {
    expect(normaliseSnoozeDate('2026-08-20', TODAY)).toBe('2026-08-20');
    expect(normaliseSnoozeDate('2026-09-15', TODAY)).toBe('2026-09-15');
  });

  it('refuses the past, junk, and dates beyond the limit', () => {
    expect(normaliseSnoozeDate('2026-08-19', TODAY)).toBeNull();
    expect(normaliseSnoozeDate('nope', TODAY)).toBeNull();
    expect(normaliseSnoozeDate('2030-01-01', TODAY)).toBeNull();
  });
});

describe('snoozeDaysLeft', () => {
  it('counts down and reads zero on the last day', () => {
    expect(snoozeDaysLeft({ snoozed_until: '2026-08-27' }, TODAY)).toBe(7);
    expect(snoozeDaysLeft({ snoozed_until: TODAY }, TODAY)).toBe(0);
    expect(snoozeDaysLeft({ snoozed_until: '2026-08-01' }, TODAY)).toBeNull();
  });
});
