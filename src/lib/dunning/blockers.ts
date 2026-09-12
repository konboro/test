import { channelAvailable } from '@/lib/providers';
import type { CommChannel, DunningStep, InvoiceStatus } from '@/types/database';

import { enabledChannels } from './channel-policy';
import { automationPaused } from './engine';
import { nextScheduledRung, type Scenario } from './scenario';
import { isSnoozed } from './snooze';

/**
 * Why this invoice will not be written to.
 *
 * There are eight independent ways a reminder can fail to go out, spread over
 * three tables and two feature flags: the company's master switch, its two
 * channel switches, the invoice's own pause, the customer's mute, the
 * customer's snooze, an open "I already paid" report, having no email and no
 * phone, and an empty ladder. Each is sensible on its own. Together they are a
 * system where "why did this customer get nothing?" had no answer short of
 * reading the sweep — and where two of them could cancel each other out
 * without anybody noticing, which is exactly what happened between
 * `automation_enabled` and `scenario_mode`.
 *
 * So the reasons are collected in one place, in the order the sweep applies
 * them, and the screen prints them. Pure: no database, no clock, no dictionary
 * — it returns reason codes and the one number each needs, and the caller turns
 * those into sentences. That makes the whole thing testable against the engine
 * it is meant to describe, which is the only way it stays true as the engine
 * changes.
 */
export type BlockerCode =
  | 'settled'
  | 'cancelled'
  | 'writtenOff'
  | 'accountOff'
  | 'noChannels'
  | 'invoicePaused'
  | 'muted'
  | 'snoozed'
  | 'reported'
  | 'unreachable'
  | 'noProvider'
  | 'nothingScheduled'
  | 'noCredits';

export interface Blocker {
  code: BlockerCode;
  /** The day a snooze lifts, for the one reason that ends by itself. */
  until?: string;
}

export interface BlockerInput {
  invoice: {
    status: InvoiceStatus;
    due_date: string;
    automation_enabled?: boolean | null;
    scenario_mode?: string | null;
  };
  debtor: {
    email: string | null;
    phone: string | null;
    muted?: boolean | null;
    snoozed_until?: string | null;
  };
  tenant: {
    automation_enabled?: boolean | null;
    email_enabled?: boolean | null;
    sms_enabled?: boolean | null;
    sms_credits?: number | null;
  };
  /** An open report of either kind, which contests the debt. */
  reported: boolean;
  /** Whether SMS is metered for this deployment at all. */
  smsMetered: boolean;
  scenario: Scenario;
  completed: ReadonlySet<DunningStep>;
  today: string;
}

const CLOSED: Partial<Record<InvoiceStatus, BlockerCode>> = {
  paid: 'settled',
  cancelled: 'cancelled',
  written_off: 'writtenOff',
};

export function sendBlockers(input: BlockerInput): Blocker[] {
  const { invoice, debtor, tenant, scenario, completed, today } = input;

  // A closed invoice is the end of the story, not one reason among several:
  // nothing below it applies, and listing "and the customer is muted" beside
  // "this was paid" invites somebody to go and unmute them.
  const closed = CLOSED[invoice.status];
  if (closed) return [{ code: closed }];

  const out: Blocker[] = [];

  // The order below is the sweep's own, so a reader fixing them top to bottom
  // is undoing them in the order the engine will check them.
  if (tenant.automation_enabled === false) out.push({ code: 'accountOff' });

  const switchedOn = enabledChannels(['email', 'sms'] as CommChannel[], tenant);
  if (switchedOn.length === 0) out.push({ code: 'noChannels' });

  if (automationPaused(invoice)) out.push({ code: 'invoicePaused' });
  if (debtor.muted) out.push({ code: 'muted' });
  if (isSnoozed(debtor, today)) {
    out.push({ code: 'snoozed', until: debtor.snoozed_until ?? undefined });
  }
  if (input.reported) out.push({ code: 'reported' });

  // Reachability is about this customer rather than this invoice, so it is
  // worth saying even when something above already stops the send: unmuting
  // somebody with no email and no phone number achieves nothing.
  if (!debtor.email && !debtor.phone) out.push({ code: 'unreachable' });

  const upcoming = nextScheduledRung(invoice.due_date, today, scenario, completed);
  if (!upcoming) out.push({ code: 'nothingScheduled' });

  // The last two are about the step that is actually coming, so they need one.
  if (upcoming) {
    const rung = scenario.steps.find((step) => step.step === upcoming.step);
    const wanted = (rung?.channels ?? []) as CommChannel[];

    const reachable = wanted.filter((channel) =>
      channel === 'email' ? Boolean(debtor.email) : Boolean(debtor.phone),
    );
    const usable = enabledChannels(reachable, tenant).filter(channelAvailable);

    // Distinguished from `unreachable`: the customer can be written to, but not
    // on the channel this particular rung uses.
    if (wanted.length > 0 && reachable.length > 0 && usable.length === 0) {
      out.push({ code: 'noProvider' });
    }

    // Only when SMS is the whole of the next step. An email rung does not care
    // about the meter, and saying so would send somebody to buy credits they do
    // not need.
    if (
      input.smsMetered &&
      usable.length > 0 &&
      usable.every((channel) => channel === 'sms') &&
      (tenant.sms_credits ?? 0) <= 0
    ) {
      out.push({ code: 'noCredits' });
    }
  }

  return out;
}
