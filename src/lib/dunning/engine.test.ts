import { describe, expect, it } from 'vitest';

import { addDays, athensDate, daysBetween, toCents } from '@/lib/money';
import { normalisePhone, segmentCount } from '@/lib/sms/send';

import { LADDER, stepForInvoice } from './engine';
import { workflowStatus } from './status';

const TODAY = '2026-08-15';

describe('stepForInvoice', () => {
  it('fires step 1 three days before the due date', () => {
    expect(stepForInvoice(addDays(TODAY, 3), TODAY)?.step).toBe('pre_due');
  });

  it('stays silent between the pre-due window and day 2 overdue', () => {
    // Due today, and one day overdue: nothing scheduled.
    expect(stepForInvoice(TODAY, TODAY)).toBeNull();
    expect(stepForInvoice(addDays(TODAY, -1), TODAY)).toBeNull();
  });

  it('fires step 2 at two days overdue', () => {
    const rung = stepForInvoice(addDays(TODAY, -2), TODAY);
    expect(rung?.step).toBe('overdue_2');
    expect(rung?.channels).toEqual(['email', 'sms']);
  });

  it('fires step 3 at ten days overdue and beyond', () => {
    expect(stepForInvoice(addDays(TODAY, -10), TODAY)?.step).toBe('overdue_10');
    expect(stepForInvoice(addDays(TODAY, -45), TODAY)?.step).toBe('overdue_10');
  });

  it('catches up a missed run rather than skipping the step', () => {
    // Cron did not run on the exact trigger day; the invoice is now 5 days
    // overdue and must still receive step 2.
    expect(stepForInvoice(addDays(TODAY, -5), TODAY)?.step).toBe('overdue_2');
  });

  it('abandons invoices far past due', () => {
    expect(stepForInvoice(addDays(TODAY, -200), TODAY)).toBeNull();
  });

  it('never sends SMS on the pre-due step', () => {
    const preDue = LADDER.find((r) => r.step === 'pre_due');
    expect(preDue?.channels).toEqual(['email']);
  });

  it('assigns every overdue day to exactly one step', () => {
    // No gaps and no overlaps between the two overdue rungs, so an invoice can
    // never match two steps on the same day.
    for (let day = 2; day <= 60; day += 1) {
      const matches = LADDER.filter((r) => day >= r.offsetFrom && day <= r.offsetUntil);
      expect(matches).toHaveLength(1);
    }
  });
});

describe('per-step reachability', () => {
  /** Mirrors the deliverability check the engine applies before claiming a contact. */
  function deliverable(
    channels: ReadonlyArray<'email' | 'sms'>,
    debtor: { email: string | null; phone: string | null },
  ) {
    return channels.some((channel) =>
      channel === 'email' ? Boolean(debtor.email) : normalisePhone(debtor.phone) !== null,
    );
  }

  const phoneOnly = { email: null, phone: '6971234567' };
  const emailOnly = { email: 'a@b.gr', phone: null };

  it('does not spend a contact on an email-only step for a phone-only debtor', () => {
    expect(deliverable(['email'], phoneOnly)).toBe(false);
  });

  it('still contacts a phone-only debtor on the email+SMS steps', () => {
    expect(deliverable(['email', 'sms'], phoneOnly)).toBe(true);
  });

  it('contacts an email-only debtor on every step', () => {
    expect(deliverable(['email'], emailOnly)).toBe(true);
    expect(deliverable(['email', 'sms'], emailOnly)).toBe(true);
  });

  it('skips a debtor with an unusable phone and no email', () => {
    expect(deliverable(['email', 'sms'], { email: null, phone: '123' })).toBe(false);
  });
});

describe('workflowStatus', () => {
  it('reports paid invoices as settled regardless of due date', () => {
    const status = workflowStatus(
      { status: 'paid', due_date: addDays(TODAY, -30) },
      new Set(),
      TODAY,
    );
    expect(status.tone).toBe('positive');
  });

  it('reflects the highest step already sent', () => {
    const status = workflowStatus(
      { status: 'pending', due_date: addDays(TODAY, -12) },
      new Set(['overdue_2', 'overdue_10']),
      TODAY,
    );
    expect(status.label).toContain('Βήμα 3');
  });
});

describe('date helpers', () => {
  it('counts whole days across a month boundary', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
  });

  it('is symmetric with addDays', () => {
    expect(daysBetween(TODAY, addDays(TODAY, 7))).toBe(7);
  });

  it('formats an Athens calendar date', () => {
    expect(athensDate(new Date('2026-08-15T22:30:00Z'))).toBe('2026-08-16');
  });
});

describe('money', () => {
  it('converts to integer cents without float drift', () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe('phone normalisation', () => {
  it('accepts the common Greek formats', () => {
    expect(normalisePhone('6971234567')).toBe('+306971234567');
    expect(normalisePhone('+30 697 123 4567')).toBe('+306971234567');
    expect(normalisePhone('00306971234567')).toBe('+306971234567');
    expect(normalisePhone('306971234567')).toBe('+306971234567');
  });

  it('rejects anything it cannot trust', () => {
    expect(normalisePhone('123')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
});

describe('sms segmentation', () => {
  it('treats Greek text as UCS-2', () => {
    expect(segmentCount('Καλημέρα')).toBe(1);
    expect(segmentCount('Κ'.repeat(80))).toBeGreaterThan(1);
  });

  it('allows 160 characters of GSM text in one segment', () => {
    expect(segmentCount('a'.repeat(160))).toBe(1);
    expect(segmentCount('a'.repeat(161))).toBe(2);
  });
});
