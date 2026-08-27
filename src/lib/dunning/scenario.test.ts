import { describe, expect, it } from 'vitest';

import { activeSteps, DEFAULT_SCENARIO, rungFor, type Scenario } from './scenario';

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  ...DEFAULT_SCENARIO,
  ...over,
  steps: over.steps ?? DEFAULT_SCENARIO.steps.map((s) => ({ ...s })),
  repeat: { ...DEFAULT_SCENARIO.repeat, ...(over.repeat ?? {}) },
});

describe('the default scenario', () => {
  // The day before the due date, three days after it, then ten. The first two
  // moved when the notice on issue was added: with the customer already told
  // about the invoice, a reminder three days early is one message too many.
  it('fires each step on the day it is placed', () => {
    expect(rungFor(-1, scenario())?.step).toBe('pre_due');
    expect(rungFor(3, scenario())?.step).toBe('overdue_2');
    expect(rungFor(10, scenario())?.step).toBe('overdue_10');
  });

  it('never lets a pre-due reminder fire once the invoice is due', () => {
    // Firing "your invoice falls due shortly" on the day it fell due, or after,
    // would be wrong whatever the following step is set to.
    const s = scenario();
    s.steps[1]!.enabled = false;
    s.steps[2]!.enabled = false;
    expect(rungFor(-1, s)?.step).toBe('pre_due');
    expect(rungFor(0, s)).toBeNull();
    expect(rungFor(30, s)).toBeNull();
  });

  it('keeps each step owning the days up to the next one', () => {
    // A missed cron run has to be caught up, not skipped — that is what the
    // windows are for.
    expect(rungFor(-1, scenario())?.step).toBe('pre_due');
    expect(rungFor(9, scenario())?.step).toBe('overdue_2');
    expect(rungFor(400, scenario())).toBeNull();
    expect(rungFor(119, scenario())?.step).toBe('overdue_10');
  });

  it('says nothing in the gap the ladder leaves around the due date', () => {
    expect(rungFor(0, scenario())).toBeNull();
    expect(rungFor(1, scenario())).toBeNull();
  });

  it('stops for good after 120 days', () => {
    expect(rungFor(121, scenario())).toBeNull();
  });
});

describe('a scenario the tenant has changed', () => {
  it('skips a step that is switched off', () => {
    const s = scenario();
    s.steps[1]!.enabled = false;

    // The days the disabled step owned fall silent; they are not handed back to
    // the pre-due reminder, which by definition cannot fire after the due date.
    expect(rungFor(3, s)).toBeNull();
    expect(rungFor(-1, s)?.step).toBe('pre_due');
    expect(rungFor(10, s)?.step).toBe('overdue_10');
  });

  it('treats a step with no channel as switched off', () => {
    // A step that reaches nobody would otherwise claim its window and deliver
    // nothing, which reads as the ladder silently stalling.
    const s = scenario();
    s.steps[1]!.channels = [];
    expect(rungFor(3, s)).toBeNull();
    expect(rungFor(10, s)?.step).toBe('overdue_10');
  });

  it('orders by when a step fires, not by what it is called', () => {
    const s = scenario();
    s.steps[1]!.offsetDays = 20;
    s.steps[2]!.offsetDays = 5;
    expect(activeSteps(s).map((x) => x.step)).toEqual(['pre_due', 'overdue_10', 'overdue_2']);
    expect(rungFor(5, s)?.step).toBe('overdue_10');
    expect(rungFor(20, s)?.step).toBe('overdue_2');
  });

  it('carries the channels of the step that fired', () => {
    const s = scenario();
    s.steps[1]!.channels = ['sms'];
    expect(rungFor(3, s)?.channels).toEqual(['sms']);
  });

  it('says nothing when every step is off', () => {
    const s = scenario();
    for (const step of s.steps) step.enabled = false;
    expect(rungFor(5, s)).toBeNull();
  });
});

describe('repeating the last step', () => {
  const repeating = () => scenario({ repeat: { enabled: true, everyDays: 14, max: 3 } });

  it('leaves the first pass alone', () => {
    expect(rungFor(10, repeating())).toMatchObject({ step: 'overdue_10', cycle: 0 });
    expect(rungFor(23, repeating())).toMatchObject({ cycle: 0 });
  });

  it('comes round again on the interval, counting the cycle', () => {
    // The cycle is what lets the same step fire twice without breaking the
    // "once per invoice" guarantee — it is unique per (invoice, step, cycle).
    expect(rungFor(24, repeating())).toMatchObject({ step: 'overdue_10', cycle: 1 });
    expect(rungFor(38, repeating())).toMatchObject({ cycle: 2 });
    expect(rungFor(52, repeating())).toMatchObject({ cycle: 3 });
  });

  it('stops after the last repeat, even though the invoice is still unpaid', () => {
    expect(rungFor(66, repeating())).toBeNull();
    expect(rungFor(80, repeating())).toBeNull();
  });

  it('does not repeat at all when the tenant has not asked for it', () => {
    expect(rungFor(60, scenario())).toMatchObject({ step: 'overdue_10', cycle: 0 });
  });

  it('never repeats past the abandon point', () => {
    const s = scenario({ repeat: { enabled: true, everyDays: 30, max: 6 } });
    expect(rungFor(130, s)).toBeNull();
  });
});
