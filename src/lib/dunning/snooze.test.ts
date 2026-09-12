import { describe, expect, it } from 'vitest';

import {
  isSnoozed,
  MAX_SNOOZE_DAYS,
  MAX_SNOOZE_NOTE,
  normaliseSnoozeDate,
  normaliseSnoozeNote,
  resolveSnooze,
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

describe('resolveSnooze', () => {
  // The dialog posts every field it holds, and the date input is prefilled
  // with the pause that is already running — so each button arrives carrying
  // the other buttons' data.
  const RUNNING = '2026-09-04';

  it('lifts the pause even though the old date rides along', () => {
    expect(resolveSnooze({ resume: true, until: RUNNING, days: '' }, TODAY)).toBeNull();
  });

  it('lets a preset change a pause that is already running', () => {
    expect(resolveSnooze({ days: '7', until: RUNNING }, TODAY)).toBe('2026-08-26');
  });

  it('takes the typed date when no preset was pressed', () => {
    expect(resolveSnooze({ days: '', until: '2026-09-15' }, TODAY)).toBe('2026-09-15');
  });

  it('is nothing at all when nothing was asked for', () => {
    expect(resolveSnooze({}, TODAY)).toBeNull();
    expect(resolveSnooze({ days: '', until: '' }, TODAY)).toBeNull();
  });

  it('still refuses what the validators refuse', () => {
    expect(resolveSnooze({ days: '9999' }, TODAY)).toBeNull();
    expect(resolveSnooze({ until: '2026-08-19' }, TODAY)).toBeNull();
    expect(resolveSnooze({ until: 'nope' }, TODAY)).toBeNull();
  });
});

describe('normaliseSnoozeNote', () => {
  it('keeps one tidy line', () => {
    expect(normaliseSnoozeNote('  promised a transfer\n  on the 15th ')).toBe(
      'promised a transfer on the 15th',
    );
  });

  it('is null when there is nothing to say', () => {
    expect(normaliseSnoozeNote('')).toBeNull();
    expect(normaliseSnoozeNote('   ')).toBeNull();
    expect(normaliseSnoozeNote(null)).toBeNull();
    expect(normaliseSnoozeNote(undefined)).toBeNull();
  });

  it('is bounded, because it renders on a list row', () => {
    expect(normaliseSnoozeNote('x'.repeat(500))).toHaveLength(MAX_SNOOZE_NOTE);
  });
});

describe('snoozeDaysLeft', () => {
  it('counts down and reads zero on the last day', () => {
    expect(snoozeDaysLeft({ snoozed_until: '2026-08-27' }, TODAY)).toBe(7);
    expect(snoozeDaysLeft({ snoozed_until: TODAY }, TODAY)).toBe(0);
    expect(snoozeDaysLeft({ snoozed_until: '2026-08-01' }, TODAY)).toBeNull();
  });
});
