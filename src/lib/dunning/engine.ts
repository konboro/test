import { athensDate, daysBetween } from '@/lib/money';
import { channelAvailable, providerStatus, type Channel, type ProviderStatus } from '@/lib/providers';
import { normalisePhone } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, DunningStep, InvoiceRow, UserRow } from '@/types/database';

import { dispatchContact } from './dispatch';
import { DEFAULT_SCENARIO, rungFor, type Scenario } from './scenario';
import { loadTemplateOverrides } from './template-store';
import type { TemplateOverrides } from './templates';

/**
 * The dunning ladder.
 *
 * Fixed and hard-coded on purpose: a predictable, bounded cadence is what keeps
 * lefta on the software-provider side of the line. Tenants can pause automation
 * or mute a debtor, but they cannot add steps or shorten the intervals.
 *
 * `offsetFrom` is days past the due date (negative = before it). Each step fires
 * when the invoice is at or past its threshold and the next step has not been
 * reached, so a missed cron run is caught up on the following day instead of
 * being silently skipped.
 */
export const LADDER: ReadonlyArray<{
  step: DunningStep;
  offsetFrom: number;
  offsetUntil: number;
  channels: ReadonlyArray<'email' | 'sms'>;
}> = [
  { step: 'pre_due', offsetFrom: -3, offsetUntil: -1, channels: ['email'] },
  { step: 'overdue_2', offsetFrom: 2, offsetUntil: 9, channels: ['email', 'sms'] },
  { step: 'overdue_10', offsetFrom: 10, offsetUntil: Number.POSITIVE_INFINITY, channels: ['email', 'sms'] },
] as const;

export interface DunningRunResult {
  runDate: string;
  tenantsProcessed: number;
  invoicesConsidered: number;
  contactsMade: number;
  emailsSent: number;
  smsSent: number;
  skipped: Array<{ invoiceId: string; reason: string }>;
  errors: Array<{ invoiceId: string; error: string }>;
  /** What could actually have been delivered during this run. */
  providers: ProviderStatus;
}

interface Candidate {
  invoice: InvoiceRow;
  debtor: DebtorRow;
  step: DunningStep;
  channels: ReadonlyArray<Channel>;
  daysOverdue: number;
  /** 0 on the first pass; a repeat of the final step increments it. */
  cycle: number;
}

/** Channels on which this debtor can be reached, ignoring provider setup. */
export function reachableChannels(
  channels: ReadonlyArray<Channel>,
  debtor: { email: string | null; phone: string | null },
): Channel[] {
  return channels.filter((channel) =>
    channel === 'email' ? Boolean(debtor.email) : normalisePhone(debtor.phone) !== null,
  );
}

/**
 * Channels that can carry a message right now: the debtor is reachable on them
 * *and* the provider behind them is configured.
 *
 * The engine consults this before claiming a contact row, never after. A step
 * that cannot be delivered must not be consumed — see lib/providers.ts.
 */
export function deliverableChannels(
  channels: ReadonlyArray<Channel>,
  debtor: { email: string | null; phone: string | null },
): Channel[] {
  return reachableChannels(channels, debtor).filter(channelAvailable);
}

/** Which ladder step, if any, an invoice is due for today. */
export function stepForInvoice(
  dueDate: string,
  today: string,
  scenario: Scenario = DEFAULT_SCENARIO,
) {
  return rungFor(daysBetween(dueDate, today), scenario);
}

/**
 * The tenant's scenario, or the built-in one where they have not set it.
 *
 * Falls back per part rather than all-or-nothing: a tenant who has configured
 * the steps but never touched the repeat should get their steps and the default
 * repeat, not the whole default back.
 */
export async function loadScenario(userId: string): Promise<Scenario> {
  const supabase = createAdminClient();

  const [{ data: steps }, { data: settings }] = await Promise.all([
    supabase.from('dunning_steps').select('*').eq('user_id', userId),
    supabase.from('dunning_settings').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  const configured = new Map((steps ?? []).map((row) => [row.step, row]));

  return {
    steps: DEFAULT_SCENARIO.steps.map((fallback) => {
      const row = configured.get(fallback.step);
      if (!row) return { ...fallback };

      return {
        step: fallback.step,
        enabled: row.enabled,
        offsetDays: row.offset_days,
        channels: row.channels as Channel[],
      };
    }),
    repeat: settings
      ? {
          enabled: settings.repeat_enabled,
          everyDays: settings.repeat_every_days,
          max: settings.repeat_max,
        }
      : { ...DEFAULT_SCENARIO.repeat },
  };
}

/**
 * Runs the daily sweep for every tenant with automation enabled.
 *
 * Ordering matters: within a tenant, debtors are processed most-overdue-first,
 * because each debtor may only be contacted once per day and the oldest debt is
 * the one worth spending that contact on.
 */
export async function runDunningSweep(
  options: { userId?: string; dryRun?: boolean } = {},
): Promise<DunningRunResult> {
  const supabase = createAdminClient();
  const today = athensDate();

  const result: DunningRunResult = {
    runDate: today,
    tenantsProcessed: 0,
    invoicesConsidered: 0,
    contactsMade: 0,
    emailsSent: 0,
    smsSent: 0,
    skipped: [],
    errors: [],
    providers: providerStatus(),
  };

  let tenantQuery = supabase.from('users').select('*').eq('automation_enabled', true);
  if (options.userId) tenantQuery = tenantQuery.eq('id', options.userId);

  const { data: tenants, error: tenantError } = await tenantQuery;
  if (tenantError) throw new Error(`Could not load tenants: ${tenantError.message}`);

  for (const tenant of tenants ?? []) {
    result.tenantsProcessed += 1;
    await processTenant(tenant, today, result, options.dryRun ?? false);
  }

  return result;
}

async function processTenant(
  tenant: UserRow,
  today: string,
  result: DunningRunResult,
  dryRun: boolean,
): Promise<void> {
  const supabase = createAdminClient();

  // The cadence this tenant configured, or the built-in one if they never did.
  const scenario = await loadScenario(tenant.id);

  // AUTO-STOP is expressed here: only `pending` invoices are ever loaded. The
  // moment the Stripe webhook flips an invoice to `paid`, it leaves this set and
  // the workflow halts for it.
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('user_id', tenant.id)
    .eq('status', 'pending')
    .order('due_date', { ascending: true });

  if (error) {
    result.errors.push({ invoiceId: '-', error: `Loading invoices: ${error.message}` });
    return;
  }
  if (!invoices?.length) return;

  const debtorIds = [...new Set(invoices.map((i) => i.debtor_id))];
  const { data: debtors } = await supabase.from('debtors').select('*').in('id', debtorIds);
  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  // Build today's candidate list.
  const candidates: Candidate[] = [];

  for (const invoice of invoices) {
    result.invoicesConsidered += 1;

    const debtor = debtorsById.get(invoice.debtor_id);
    if (!debtor) {
      result.skipped.push({ invoiceId: invoice.id, reason: 'debtor missing' });
      continue;
    }
    if (debtor.muted) {
      result.skipped.push({ invoiceId: invoice.id, reason: 'debtor muted' });
      continue;
    }

    const rung = stepForInvoice(invoice.due_date, today, scenario);
    if (!rung) continue;

    // Reachability is per step, not per debtor: a debtor with only a phone
    // number cannot receive the email-only step 1, and claiming a contact for
    // them would burn their one daily slot on a message nobody gets.
    //
    // The same reasoning covers an unconfigured provider. Claiming a contact is
    // irreversible — (invoice_id, step) is unique — so a step whose providers
    // are missing must be left untouched rather than claimed and then recorded
    // as failed. It will fire on a later run, once the keys exist.
    const reachable = reachableChannels(rung.channels, debtor);
    const deliverable = reachable.filter(channelAvailable);

    if (deliverable.length === 0) {
      result.skipped.push({
        invoiceId: invoice.id,
        reason:
          reachable.length === 0
            ? `no contact details for ${rung.channels.join('/')}`
            : `${reachable.join('/')} provider not configured — step left unconsumed`,
      });
      continue;
    }

    candidates.push({
      invoice,
      debtor,
      step: rung.step,
      channels: rung.channels,
      daysOverdue: rung.daysOverdue,
      cycle: rung.cycle,
    });
  }

  // Most overdue first: each debtor gets a single contact per day, and the
  // oldest debt is the one worth spending it on.
  candidates.sort((a, b) => b.daysOverdue - a.daysOverdue);

  // Tracks debtors already contacted during this run. A debtor's remaining
  // candidates are still tried in order, because the highest-priority one may be
  // blocked by its step having already been sent on an earlier day — in which
  // case the next invoice down should get today's contact instead of the debtor
  // being skipped entirely.
  const contactedThisRun = new Set<string>();

  // One read per tenant, not per message: the templates are the same for every
  // invoice in this loop.
  const overrides = candidates.length > 0 ? await loadTemplateOverrides(tenant.id) : {};

  for (const candidate of candidates) {
    if (contactedThisRun.has(candidate.debtor.id)) continue;

    const outcome = await deliver(tenant, candidate, today, result, dryRun, overrides);

    // `dailyLimit` means the debtor was already contacted today (by an earlier
    // run, or a concurrent worker) — nothing else will get through for them.
    if (outcome === 'contacted' || outcome === 'dailyLimit') {
      contactedThisRun.add(candidate.debtor.id);
    }
  }
}

type DeliveryOutcome = 'contacted' | 'dailyLimit' | 'stepAlreadySent' | 'skipped';

async function deliver(
  tenant: UserRow,
  candidate: Candidate,
  today: string,
  result: DunningRunResult,
  dryRun: boolean,
  overrides: TemplateOverrides,
): Promise<DeliveryOutcome> {
  const supabase = createAdminClient();
  const { invoice, debtor, step } = candidate;

  if (dryRun) {
    result.contactsMade += 1;
    return 'contacted';
  }

  // Re-read the invoice immediately before sending. A payment that landed while
  // this sweep was running must abort the reminder — AUTO-STOP has to be checked
  // as late as possible, not just when the batch was assembled.
  const { data: fresh } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', invoice.id)
    .maybeSingle();

  if (!fresh || fresh.status !== 'pending') {
    result.skipped.push({ invoiceId: invoice.id, reason: `status is ${fresh?.status ?? 'gone'}` });
    return 'skipped';
  }

  // COMPLIANCE LOCK. Claiming this row is what grants the right to contact the
  // debtor today. The unique indexes make the check atomic: if another worker,
  // another invoice, or a duplicate cron invocation already claimed it, the
  // insert fails and we send nothing.
  const { data: contact, error: contactError } = await supabase
    .from('dunning_contacts')
    .insert({
      user_id: tenant.id,
      debtor_id: debtor.id,
      invoice_id: invoice.id,
      step,
      // The guarantee is now "once per invoice per cycle": a repeat of the final
      // step is a new cycle, and everything else is still cycle 0.
      cycle: candidate.cycle,
      contact_on: today,
    })
    .select('id')
    .single();

  if (contactError || !contact) {
    // 23505 = unique_violation. Which index tripped decides what happens next,
    // so read the constraint name rather than guessing.
    if (contactError?.code === '23505') {
      const dailyLimit = (contactError.message ?? '').includes('one_per_debtor_per_day');
      result.skipped.push({
        invoiceId: invoice.id,
        reason: dailyLimit ? 'daily contact limit reached' : 'step already sent for this invoice',
      });
      return dailyLimit ? 'dailyLimit' : 'stepAlreadySent';
    }

    result.errors.push({
      invoiceId: invoice.id,
      error: `contact claim failed: ${contactError?.message ?? 'unknown'}`,
    });
    return 'skipped';
  }

  result.contactsMade += 1;

  // From here the work is identical to a manual reminder, so it lives in one
  // place: same templates, same credit accounting, same audit rows.
  const sent = await dispatchContact({
    tenant,
    debtor,
    invoice,
    step,
    contactId: contact.id,
    channels: candidate.channels,
    overrides,
  });

  result.emailsSent += sent.emailsSent;
  result.smsSent += sent.smsSent;
  for (const reason of sent.skipped) result.skipped.push({ invoiceId: invoice.id, reason });
  for (const error of sent.errors) result.errors.push({ invoiceId: invoice.id, error });

  return 'contacted';
}
