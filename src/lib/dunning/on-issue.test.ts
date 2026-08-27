import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCENARIO,
  EXTRA_STEP_OFFSETS,
  LADDER_STEPS,
  activeSteps,
  rungFor,
  type Scenario,
} from './scenario';

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  onIssue: { ...DEFAULT_SCENARIO.onIssue },
  steps: DEFAULT_SCENARIO.steps.map((s) => ({ ...s })),
  repeat: { ...DEFAULT_SCENARIO.repeat },
  sendHour: DEFAULT_SCENARIO.sendHour,
  ...over,
});

/**
 * The notice on issue is not a rung.
 *
 * It has no offset, owns no window, and fires from an event rather than from a
 * date arithmetic. If it ever reached the ladder it would be handed a window
 * like everything else and go out a second time, days after the invoice was
 * raised, saying the invoice had just been raised.
 */
describe('the notice sent when an invoice is raised', () => {
  it('is on by default, by email only', () => {
    expect(DEFAULT_SCENARIO.onIssue.enabled).toBe(true);
    expect(DEFAULT_SCENARIO.onIssue.channels).toEqual(['email']);
  });

  it('is not one of the ladder steps', () => {
    expect(LADDER_STEPS).not.toContain('on_issue');
  });

  it('never claims a day on the ladder, even if stored among the steps', () => {
    const s = scenario({
      steps: [
        { step: 'on_issue', enabled: true, offsetDays: 0, channels: ['email'] },
        ...DEFAULT_SCENARIO.steps.map((step) => ({ ...step })),
      ],
    });

    expect(activeSteps(s).map((step) => step.step)).not.toContain('on_issue');
    for (let day = -30; day <= 120; day += 1) {
      expect(rungFor(day, s)?.step).not.toBe('on_issue');
    }
  });
});

describe('the rungs past the original three', () => {
  it('offers every slot the database can hold', () => {
    expect(LADDER_STEPS).toHaveLength(8);
    expect(LADDER_STEPS.slice(3)).toEqual(['step_4', 'step_5', 'step_6', 'step_7', 'step_8']);
  });

  it('proposes offsets that do not stack on the step above', () => {
    const offsets = Object.values(EXTRA_STEP_OFFSETS);
    expect(new Set(offsets).size).toBe(offsets.length);

    const last = DEFAULT_SCENARIO.steps[DEFAULT_SCENARIO.steps.length - 1];
    for (const offset of offsets) expect(offset).toBeGreaterThan(last!.offsetDays);
  });

  it('fires in the order of the offsets, not of the names', () => {
    const s = scenario({
      steps: [
        ...DEFAULT_SCENARIO.steps.map((step) => ({ ...step })),
        { step: 'step_4', enabled: true, offsetDays: 20, channels: ['email'] },
        { step: 'step_5', enabled: true, offsetDays: 30, channels: ['email', 'sms'] },
      ],
    });

    expect(rungFor(10, s)?.step).toBe('overdue_10');
    expect(rungFor(20, s)?.step).toBe('step_4');
    expect(rungFor(25, s)?.step).toBe('step_4');
    expect(rungFor(30, s)?.step).toBe('step_5');
    expect(rungFor(30, s)?.channels).toEqual(['email', 'sms']);
  });

  it('still stops for good at the abandon threshold', () => {
    const s = scenario({
      steps: [
        ...DEFAULT_SCENARIO.steps.map((step) => ({ ...step })),
        { step: 'step_8', enabled: true, offsetDays: 119, channels: ['email'] },
      ],
    });

    expect(rungFor(119, s)?.step).toBe('step_8');
    expect(rungFor(121, s)).toBeNull();
  });
});
