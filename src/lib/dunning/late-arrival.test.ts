import { describe, expect, it } from 'vitest';

import { issueNoticeDecision } from './issue-notice';
import { DEFAULT_SCENARIO, rungFor } from './scenario';

const TODAY = '2026-08-28';

const invoice = (dueDate: string) => ({
  status: 'pending' as const,
  due_date: dueDate,
  automation_enabled: true,
  scenario_mode: 'default' as const,
  issue_notice_sent_at: null,
});

const notice = (dueDate: string) =>
  issueNoticeDecision({
    invoice: invoice(dueDate),
    tenantAutomationEnabled: true,
    onIssue: { ...DEFAULT_SCENARIO.onIssue },
    today: TODAY,
  });

/**
 * An invoice that arrives already late.
 *
 * The common case is a backlog: a debt raised weeks ago, entered now. What must
 * not happen is the system announcing it as newly issued, and what must happen
 * is that it lands on the ladder at the rung matching its real age rather than
 * starting from the beginning.
 */
describe('an invoice added after its due date', () => {
  it('sends no notice on issue, even one day late', () => {
    expect(notice('2026-08-27')).toEqual({
      send: false,
      reason: 'already past its due date',
    });
  });

  it('still sends the notice for one due today', () => {
    // Raised and due the same day is unusual but legitimate, and the customer
    // has more reason to hear about it, not less.
    expect(notice(TODAY)).toEqual({ send: true });
  });

  it('sends the notice for one still ahead of its due date', () => {
    expect(notice('2026-09-15')).toEqual({ send: true });
  });
});

describe('where a late arrival lands on the ladder', () => {
  const step = (daysOverdue: number) => rungFor(daysOverdue, DEFAULT_SCENARIO)?.step ?? null;

  it('says nothing on the first two days past the due date', () => {
    // The pre-due reminder closes the day before the due date by definition, and
    // the first overdue step is placed on day three. Days one and two belong to
    // neither, on purpose: chasing somebody the morning after a due date reads
    // as a demand rather than a reminder.
    expect(step(1)).toBeNull();
    expect(step(2)).toBeNull();
  });

  it('fires the first overdue reminder on day three', () => {
    expect(step(3)).toBe('overdue_2');
  });

  it('catches up rather than starting from the beginning', () => {
    // An invoice entered five days late is five days late. Each step owns the
    // days up to the next one, so it fires the rung that matches the age and
    // does not replay the ones already passed.
    expect(step(5)).toBe('overdue_2');
    expect(step(9)).toBe('overdue_2');
    expect(step(10)).toBe('overdue_10');
    expect(step(45)).toBe('overdue_10');
  });

  it('never reaches back for a pre-due reminder once the date has passed', () => {
    for (let day = 0; day <= 30; day += 1) expect(step(day)).not.toBe('pre_due');
  });

  it('never stops chasing an invoice for being old', () => {
    // There used to be a threshold — 120 days — past which nothing fired again,
    // however the invoice had been entered. It was removed deliberately: a debt
    // does not stop being owed because it aged, and the operator's largest
    // balance was sitting on the wrong side of it.
    for (const day of [120, 121, 365, 2000]) {
      expect(step(day), `${day} days overdue`).toBe('overdue_10');
    }
  });
});
