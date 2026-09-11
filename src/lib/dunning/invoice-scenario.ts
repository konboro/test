import type { CommChannel, DunningStep, InvoiceScenarioMode } from '@/types/database';

import { EXTRA_STEP_OFFSETS, LADDER_STEPS, type Scenario } from './scenario';

/**
 * One invoice's cadence, as a form talks about it.
 *
 * The same fields appear in two places — beside the invoice being created, and
 * in the invoice's own view — so the names and the reading of them live here
 * rather than being written twice and drifting apart. Pure, because what a
 * person meant by the boxes they ticked is worth testing without a database.
 */

/** Prefixed so these cannot collide with the invoice's own fields on the create form. */
export const FIELD = {
  mode: 'sc_mode',
  enabled: (step: string) => `sc_${step}_enabled`,
  offset: (step: string) => `sc_${step}_offset`,
  channels: (step: string) => `sc_${step}_channels`,
} as const;

/** Mirrored from the check constraint on the table. */
const OFFSET = { min: -30, max: 120 };

const clamp = (value: number) => Math.min(OFFSET.max, Math.max(OFFSET.min, value));

export interface InvoiceScenarioInput {
  mode: InvoiceScenarioMode;
  /** Empty unless the mode is `custom`; nothing else stores rows. */
  rows: Array<{
    step: DunningStep;
    enabled: boolean;
    offset_days: number;
    channels: CommChannel[];
  }>;
}

function isMode(value: unknown): value is InvoiceScenarioMode {
  return value === 'default' || value === 'custom' || value === 'off';
}

/**
 * Reads the editor back out of a submitted form.
 *
 * A mode other than `custom` produces no rows at all, rather than rows that
 * happen to match the tenant's scenario. The difference matters later: rows
 * written today would freeze this invoice at today's cadence, and a tenant who
 * changes their scenario next month would find one invoice quietly left behind.
 *
 * `base` supplies what a field the form did not render should fall back to, so
 * a compact editor showing three rungs cannot blank the other five.
 */
export function parseInvoiceScenario(
  formData: Pick<FormData, 'get' | 'getAll'>,
  base: Scenario,
): InvoiceScenarioInput {
  const raw = formData.get(FIELD.mode);
  const mode: InvoiceScenarioMode = isMode(raw) ? raw : 'default';

  if (mode !== 'custom') return { mode, rows: [] };

  /**
   * The channels actually ticked, which is not the same as the channels stored.
   *
   * A step with none ticked is off, and that has to be read from the ticks — the
   * column refuses an empty array, so the stored list falls back to the account
   * one, and asking the stored list whether anything was ticked always answers
   * yes. Keeping the two apart is the whole point of returning both.
   */
  const channelsFor = (
    step: string,
    fallback: ReadonlyArray<CommChannel>,
  ): { chosen: CommChannel[]; stored: CommChannel[] } => {
    const chosen = formData
      .getAll(FIELD.channels(step))
      .map(String)
      .filter((c): c is CommChannel => c === 'email' || c === 'sms');

    return { chosen, stored: chosen.length ? chosen : [...fallback] };
  };

  const present = (step: string) => formData.get(FIELD.enabled(step)) !== null;

  const rows: InvoiceScenarioInput['rows'] = [];

  // The notice on issue. No offset: the column has a check constraint saying so.
  if (present('on_issue') || formData.getAll(FIELD.channels('on_issue')).length) {
    const channels = channelsFor('on_issue', base.onIssue.channels);
    rows.push({
      step: 'on_issue',
      enabled: formData.get(FIELD.enabled('on_issue')) === 'on' && channels.chosen.length > 0,
      offset_days: 0,
      channels: channels.stored,
    });
  }

  for (const step of LADDER_STEPS) {
    const fallback = base.steps.find((s) => s.step === step);
    if (!present(step) && !formData.getAll(FIELD.channels(step)).length) continue;

    const channels = channelsFor(step, fallback?.channels ?? ['email']);
    const offset = Number(formData.get(FIELD.offset(step)));

    rows.push({
      step,
      enabled: formData.get(FIELD.enabled(step)) === 'on' && channels.chosen.length > 0,
      offset_days: clamp(
        Number.isFinite(offset)
          ? offset
          : (fallback?.offsetDays ?? EXTRA_STEP_OFFSETS[step] ?? 0),
      ),
      channels: channels.stored,
    });
  }

  // The editor is a switch now, not a three-way choice: whenever reminders are
  // on it submits the cadence that was on screen. A submission identical to the
  // account's cadence is not an override — it IS the account cadence, and has
  // to be stored as such, or the invoice freezes at today's values and a tenant
  // who tunes their scenario next month finds this one quietly left behind.
  // The distinction the radio buttons used to ask for is read off the values.
  if (matchesScenario(rows, base)) return { mode: 'default', rows: [] };

  return { mode, rows };
}

function sameChannels(
  a: ReadonlyArray<CommChannel>,
  b: ReadonlyArray<CommChannel>,
): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/**
 * Whether these rows say anything the account scenario does not.
 *
 * Only the rows the form rendered are compared — a step that is not in `rows`
 * was not on screen, falls back to the account values by construction, and so
 * cannot deviate. Unticking a step that the account runs IS a deviation: the
 * enabled flags differ even though the stored channels fall back.
 */
export function matchesScenario(
  rows: InvoiceScenarioInput['rows'],
  base: Scenario,
): boolean {
  return rows.every((row) => {
    if (row.step === 'on_issue') {
      return (
        row.enabled === base.onIssue.enabled &&
        sameChannels(row.channels, base.onIssue.channels)
      );
    }

    const counterpart = base.steps.find((s) => s.step === row.step);
    if (!counterpart) return false;

    return (
      row.enabled === counterpart.enabled &&
      row.offset_days === counterpart.offsetDays &&
      sameChannels(row.channels, counterpart.channels)
    );
  });
}

/**
 * What is wrong with this cadence, in the tenant's language, or nothing.
 *
 * The same two rules the account-wide editor enforces, for the same reasons: a
 * reminder that goes out before the due date has to be set before it, and two
 * reminders on one day would race for a single contact slot with the loser
 * looking like a silent failure.
 */
export function invoiceScenarioProblem(
  input: InvoiceScenarioInput,
): 'preDueMustBeBefore' | 'offsetsMustDiffer' | null {
  const preDue = input.rows.find((row) => row.step === 'pre_due');
  if (preDue?.enabled && preDue.offset_days >= 0) return 'preDueMustBeBefore';

  const days = input.rows
    .filter((row) => row.enabled && row.step !== 'on_issue')
    .map((row) => row.offset_days);

  return new Set(days).size === days.length ? null : 'offsetsMustDiffer';
}
