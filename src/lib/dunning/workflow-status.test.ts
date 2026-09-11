import { describe, expect, it } from 'vitest';

import { DICTIONARIES } from '@/lib/i18n/dictionaries';

import { ABANDON_AFTER_DAYS, DEFAULT_SCENARIO } from './scenario';
import { workflowStatus } from './status';

/**
 * The status column said how many days late an invoice was, in words, directly
 * beside the aging column saying the same thing in figures. Two cells, one
 * fact. These pin the column to its own subject: what the chase is doing.
 */

const TODAY = '2026-09-11';
const en = DICTIONARIES.en;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const pendingSince = (days: number) => ({
  status: 'pending' as const,
  due_date: addDays(TODAY, -days),
});

describe('workflowStatus, where no step applies', () => {
  /** A scenario with nothing placed: every invoice falls through to the end. */
  const empty = { ...DEFAULT_SCENARIO, steps: DEFAULT_SCENARIO.steps.map((s) => ({ ...s, enabled: false })) };

  it('never repeats the number the aging column already shows', () => {
    for (const days of [-5, 0, 3, 40, 200]) {
      const label = workflowStatus(
        { status: 'pending', due_date: addDays(TODAY, -days) },
        new Set(),
        TODAY,
        en,
        empty,
      ).label;

      expect(label, `${days} days`).not.toMatch(/\d/);
    }
  });

  it('names the invoices the automation has given up on', () => {
    const status = workflowStatus(
      pendingSince(ABANDON_AFTER_DAYS + 1),
      new Set(),
      TODAY,
      en,
      DEFAULT_SCENARIO,
    );

    expect(status.label).toBe(en.workflow.abandoned);
    // Real money that nothing is chasing reads as a problem, not as a shrug.
    expect(status.tone).toBe('danger');
  });

  it('still chases on the threshold day itself', () => {
    // The abandon rule is "past" the threshold, not "at" it. A row that flipped
    // a day early would stop being chased a day early.
    const status = workflowStatus(
      pendingSince(ABANDON_AFTER_DAYS),
      new Set(),
      TODAY,
      en,
      DEFAULT_SCENARIO,
    );

    expect(status.label).not.toBe(en.workflow.abandoned);
  });

  it('says an overdue invoice has no step waiting, rather than how late it is', () => {
    const status = workflowStatus(pendingSince(3), new Set(), TODAY, en, empty);

    expect(status.label).toBe(en.workflow.nothingScheduled);
    expect(status.tone).toBe('danger');
  });

  it('says the chase has not begun for one that is not due yet', () => {
    const status = workflowStatus(
      { status: 'pending', due_date: addDays(TODAY, 5) },
      new Set(),
      TODAY,
      en,
      empty,
    );

    expect(status.label).toBe(en.workflow.notStarted);
    expect(status.tone).toBe('neutral');
  });

  it('keeps the day count on the object for callers that need it', () => {
    // Only the label stopped carrying the number; the value is still there for
    // sorting and for the aging column that legitimately renders it.
    expect(workflowStatus(pendingSince(7), new Set(), TODAY, en, empty).daysOverdue).toBe(7);
  });
});

describe('workflowStatus, where a step does apply', () => {
  it('still reports the rung rather than the age', () => {
    const status = workflowStatus(pendingSince(12), new Set(['overdue_2']), TODAY, en);

    expect(status.label).toContain(en.steps.shortOverdue2);
    expect(status.label).not.toMatch(/\d+ days overdue/);
  });

  it('leaves settled invoices alone', () => {
    const status = workflowStatus(
      { status: 'paid', due_date: addDays(TODAY, -300) },
      new Set(),
      TODAY,
      en,
    );

    expect(status.label).toBe(en.workflow.paid);
    expect(status.tone).toBe('positive');
  });
});

describe('workflowStatus, when a step is still coming', () => {
  it('says which day rather than the word pending', () => {
    // Due in five days, default cadence: the nudge lands the day before.
    const status = workflowStatus(
      { status: 'pending', due_date: addDays(TODAY, 5) },
      new Set(),
      TODAY,
      en,
    );

    expect(status.label).toContain('15/09');
    expect(status.label).not.toContain('pending');
    expect(status.label).not.toContain('Not started');
  });

  it('dates the rung that is due today too', () => {
    const status = workflowStatus(pendingSince(3), new Set(), TODAY, en);

    expect(status.label).toContain(en.steps.shortOverdue2);
    expect(status.label).toMatch(/[0-9]{2}.[0-9]{2}/);
  });
});
