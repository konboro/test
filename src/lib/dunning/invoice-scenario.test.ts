import { describe, expect, it } from 'vitest';

import { FIELD, invoiceScenarioProblem, parseInvoiceScenario } from './invoice-scenario';
import { DEFAULT_SCENARIO } from './scenario';

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

const base = DEFAULT_SCENARIO;

describe('reading the editor back', () => {
  it('defaults to the account cadence when nothing was chosen', () => {
    expect(parseInvoiceScenario(form([]), base)).toEqual({ mode: 'default', rows: [] });
  });

  it('rejects a mode it does not recognise rather than storing it', () => {
    expect(parseInvoiceScenario(form([[FIELD.mode, 'everything']]), base).mode).toBe('default');
  });

  it('stores no rows for the account cadence', () => {
    // Rows written today would freeze this invoice at today's cadence, and a
    // tenant who changes their scenario next month would find one invoice
    // quietly left behind on the old one.
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'default'],
        [FIELD.enabled('pre_due'), 'on'],
        [FIELD.offset('pre_due'), '-5'],
      ]),
      base,
    );

    expect(parsed.rows).toEqual([]);
  });

  it('stores no rows when reminders are switched off either', () => {
    const parsed = parseInvoiceScenario(form([[FIELD.mode, 'off']]), base);
    expect(parsed).toEqual({ mode: 'off', rows: [] });
  });

  it('reads the days and channels of an overridden step', () => {
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'custom'],
        [FIELD.enabled('pre_due'), 'on'],
        [FIELD.offset('pre_due'), '-7'],
        [FIELD.channels('pre_due'), 'email'],
        [FIELD.channels('pre_due'), 'sms'],
      ]),
      base,
    );

    expect(parsed.mode).toBe('custom');
    expect(parsed.rows).toEqual([
      { step: 'pre_due', enabled: true, offset_days: -7, channels: ['email', 'sms'] },
    ]);
  });

  it('leaves a step the form never showed alone', () => {
    // A compact editor shows the rungs a tenant placed. The five it does not
    // show must come back unmentioned, not blanked.
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'custom'],
        [FIELD.enabled('pre_due'), 'on'],
        [FIELD.offset('pre_due'), '-1'],
        [FIELD.channels('pre_due'), 'email'],
      ]),
      base,
    );

    expect(parsed.rows.map((row) => row.step)).toEqual(['pre_due']);
  });

  it('treats a step with every channel unticked as switched off', () => {
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'custom'],
        [FIELD.enabled('overdue_2'), 'on'],
        [FIELD.offset('overdue_2'), '3'],
      ]),
      base,
    );

    const row = parsed.rows.find((r) => r.step === 'overdue_2');
    expect(row?.enabled).toBe(false);
    // Falls back to the account channels rather than storing an empty array,
    // which the column refuses.
    expect(row?.channels).toEqual(['email', 'sms']);
  });

  it('pins the notice on issue to no offset', () => {
    // The column has a check constraint saying exactly this. A stored day would
    // imply a schedule the engine never reads.
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'custom'],
        [FIELD.enabled('on_issue'), 'on'],
        [FIELD.offset('on_issue'), '9'],
        [FIELD.channels('on_issue'), 'email'],
      ]),
      base,
    );

    expect(parsed.rows.find((r) => r.step === 'on_issue')?.offset_days).toBe(0);
  });

  it('clamps a day past what the database allows', () => {
    const parsed = parseInvoiceScenario(
      form([
        [FIELD.mode, 'custom'],
        [FIELD.enabled('overdue_10'), 'on'],
        [FIELD.offset('overdue_10'), '9999'],
        [FIELD.channels('overdue_10'), 'email'],
      ]),
      base,
    );

    expect(parsed.rows.find((r) => r.step === 'overdue_10')?.offset_days).toBe(120);
  });
});

describe('what the editor refuses to save', () => {
  const custom = (rows: Array<[string, string]>) =>
    parseInvoiceScenario(form([[FIELD.mode, 'custom'], ...rows]), base);

  it('accepts a cadence with nothing wrong with it', () => {
    expect(
      invoiceScenarioProblem(
        custom([
          [FIELD.enabled('pre_due'), 'on'],
          [FIELD.offset('pre_due'), '-1'],
          [FIELD.channels('pre_due'), 'email'],
          [FIELD.enabled('overdue_2'), 'on'],
          [FIELD.offset('overdue_2'), '3'],
          [FIELD.channels('overdue_2'), 'email'],
        ]),
      ),
    ).toBeNull();
  });

  it('refuses a pre-due reminder placed after the due date', () => {
    expect(
      invoiceScenarioProblem(
        custom([
          [FIELD.enabled('pre_due'), 'on'],
          [FIELD.offset('pre_due'), '2'],
          [FIELD.channels('pre_due'), 'email'],
        ]),
      ),
    ).toBe('preDueMustBeBefore');
  });

  it('refuses two reminders on the same day', () => {
    // They would race for one contact slot and the loser would look like a
    // silent failure.
    expect(
      invoiceScenarioProblem(
        custom([
          [FIELD.enabled('overdue_2'), 'on'],
          [FIELD.offset('overdue_2'), '5'],
          [FIELD.channels('overdue_2'), 'email'],
          [FIELD.enabled('overdue_10'), 'on'],
          [FIELD.offset('overdue_10'), '5'],
          [FIELD.channels('overdue_10'), 'email'],
        ]),
      ),
    ).toBe('offsetsMustDiffer');
  });

  it('does not count the notice on issue as sharing a day', () => {
    // It has no day. Counting its zero would collide with a reminder placed on
    // the due date itself, which is legitimate.
    expect(
      invoiceScenarioProblem(
        custom([
          [FIELD.enabled('on_issue'), 'on'],
          [FIELD.channels('on_issue'), 'email'],
          [FIELD.enabled('overdue_2'), 'on'],
          [FIELD.offset('overdue_2'), '0'],
          [FIELD.channels('overdue_2'), 'email'],
        ]),
      ),
    ).toBeNull();
  });

  it('ignores a disabled step that shares a day', () => {
    expect(
      invoiceScenarioProblem(
        custom([
          [FIELD.enabled('overdue_2'), 'on'],
          [FIELD.offset('overdue_2'), '5'],
          [FIELD.channels('overdue_2'), 'email'],
          [FIELD.offset('overdue_10'), '5'],
          [FIELD.channels('overdue_10'), 'email'],
        ]),
      ),
    ).toBeNull();
  });
});
