import { daysBetween, zonedDate, zonedHour } from '@/lib/money';
import { channelAvailable, providerStatus, type Channel, type ProviderStatus } from '@/lib/providers';
import { normalisePhone } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, DunningStep, InvoiceRow, UserRow } from '@/types/database';

import { dispatchContact } from './dispatch';
import {
  DEFAULT_SCENARIO,
  EXTRA_STEP_OFFSETS,
  LADDER_STEPS,
  rungFor,
  scenarioWithOverrides,
  type Scenario,
  sendWindowOpen,
} from './scenario';
import { enabledChannels } from './channel-policy';
import { sweepIssueNotices } from './issue-notice';
import { isSnoozed } from './snooze';
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
  /**
   * Notices sent for invoices raised while the send at confirmation time did
   * not happen. Normally zero — anything else is worth noticing.
   */
  issueNoticesSent: number;
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
/**
 * Whether chasing has been switched off for this one invoice.
 *
 * Reads both columns, because the answer is stored twice. `scenario_mode` of
 * 'off' and `automation_enabled` of false mean the same thing, and every writer
 * is supposed to keep them in step — but the checkbox on the invoice list could
 * only ever write one of them, so they could drift apart. When they did, the
 * sweep resumed the ladder off one column while the invoice's own page reported
 * nothing scheduled off the other. Asking both here means the disagreement can
 * only ever be resolved in favour of not writing to somebody.
 *
 * Both comparisons are against a literal on purpose. Neither column exists until
 * its migration is applied, so on a database that has not taken them the field
 * is absent — and a truthiness test reads absent as paused, for every invoice
 * the tenant has. Deploys and migrations do not land together, and that failure
 * would be silent: no reminders, no error, a sweep reporting everything skipped.
 * Pinned by a test for exactly that reason.
 */
export function automationPaused(invoice: {
  automation_enabled?: boolean | null;
  scenario_mode?: string | null;
}): boolean {
  return invoice.automation_enabled === false || invoice.scenario_mode === 'off';
}

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

  const defaults = new Map(DEFAULT_SCENARIO.steps.map((step) => [step.step, step]));
  const issue = configured.get('on_issue');

  return {
    onIssue: issue
      ? { enabled: issue.enabled, channels: issue.channels as Channel[] }
      : { ...DEFAULT_SCENARIO.onIssue },

    // Every rung the ladder can hold, not only the three that have defaults.
    // A slot nobody has placed comes back switched off, so it changes nothing
    // until a tenant reaches for it — but it comes back, because the editor has
    // to be able to offer it and the engine has to agree it exists.
    steps: LADDER_STEPS.map((step) => {
      const row = configured.get(step);
      if (row) {
        return {
          step,
          enabled: row.enabled,
          offsetDays: row.offset_days,
          channels: row.channels as Channel[],
        };
      }

      const fallback = defaults.get(step);
      if (fallback) return { ...fallback };

      return {
        step,
        enabled: false,
        offsetDays: EXTRA_STEP_OFFSETS[step] ?? 30,
        channels: ['email' as Channel],
      };
    }),
    repeat: settings
      ? {
          enabled: settings.repeat_enabled,
          everyDays: settings.repeat_every_days,
          max: settings.repeat_max,
        }
      : { ...DEFAULT_SCENARIO.repeat },
    sendHour: settings?.send_hour ?? DEFAULT_SCENARIO.sendHour,
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
  // Only for the report header. Each tenant is then swept in its own day, which
  // is the one that decides whether their invoices are late.
  const today = zonedDate();

  const result: DunningRunResult = {
    runDate: today,
    tenantsProcessed: 0,
    invoicesConsidered: 0,
    contactsMade: 0,
    issueNoticesSent: 0,
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
    await processTenant(tenant, zonedDate(tenant.timezone), result, options.dryRun ?? false);
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

  // Not held back by the hour a tenant chose to chase at. The notice on issue
  // is a copy of a document rather than part of a cadence, and one that failed
  // to send this morning should go now, not tomorrow morning. Normally there is
  // nothing to do here at all: the send happens when the invoice is confirmed,
  // and this only catches what did not.
  if (!dryRun) result.issueNoticesSent += await sweepIssueNotices(tenant.id);

  // Nothing leaves before the hour the tenant chose.
  //
  // Read in their own timezone, never UTC: a fixed UTC schedule lands an hour
  // later in summer than in winter, and somebody who picked nine would be moved
  // to ten twice a year without touching anything.
  //
  // This used to sit behind a SWEEP_HOURLY flag that was never set, so the hour
  // was a control that saved a value and changed nothing. The flag is gone —
  // a setting that only works once someone remembers an environment variable is
  // a setting that does not work.
  if (!sendWindowOpen(zonedHour(tenant.timezone), scenario.sendHour)) return;

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
  const [{ data: debtors }, { data: openReports }] = await Promise.all([
    // Scoped, like the report query beside it. This one trusted `debtor_id` to
    // imply the tenant, which is the assumption the whole organizations
    // refactor removed: a planted id had the nightly sweep load another
    // company's customer, message them, and file the rendered message in a log
    // the wrong company reads.
    supabase.from('debtors').select('*').eq('user_id', tenant.id).in('id', debtorIds),
    // "I already paid" / "this document is wrong", said on the payment page.
    // While one is open the invoice is contested, and chasing a contested
    // debt is the exact mistake the report feature exists to prevent.
    supabase
      .from('invoice_reports')
      .select('invoice_id, kind')
      .eq('user_id', tenant.id)
      .eq('status', 'open'),
  ]);
  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));
  const reportedInvoices = new Map((openReports ?? []).map((r) => [r.invoice_id, r.kind]));

  // Invoices following their own cadence rather than the tenant's. Loaded in
  // one query for the whole sweep: per invoice it would be a round trip each,
  // and the overwhelming majority have none.
  const customIds = invoices.filter((i) => i.scenario_mode === 'custom').map((i) => i.id);

  const { data: overrideRows } = customIds.length
    ? await supabase.from('invoice_dunning_steps').select('*').in('invoice_id', customIds)
    : { data: [] };

  const overridesByInvoice = new Map<string, typeof overrideRows>();
  for (const row of overrideRows ?? []) {
    const rows = overridesByInvoice.get(row.invoice_id) ?? [];
    rows.push(row);
    overridesByInvoice.set(row.invoice_id, rows);
  }

  /** The cadence this one document follows. */
  const scenarioFor = (invoiceId: string): Scenario => {
    const rows = overridesByInvoice.get(invoiceId);
    return rows?.length
      ? scenarioWithOverrides(scenario, rows.map((row) => ({
          step: row.step,
          enabled: row.enabled,
          offset_days: row.offset_days,
          channels: row.channels as Channel[],
        })))
      : scenario;
  };

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
    // A promise to pay by a date. Held for the person rather than the document,
    // because chasing them tomorrow about a different invoice breaks the same
    // promise. It lifts by itself — nothing clears the column.
    if (isSnoozed(debtor, today)) {
      result.skipped.push({
        invoiceId: invoice.id,
        reason: `debtor snoozed until ${debtor.snoozed_until}`,
      });
      continue;
    }
    // The narrowest of the three switches. The tenant's own flag gates the
    // whole sweep before it reaches here and `muted` gates a customer; this
    // gates one document, for the invoice that is disputed or privately
    // arranged while the rest of that customer's are chased as usual.
    if (automationPaused(invoice)) {
      result.skipped.push({ invoiceId: invoice.id, reason: 'automation paused for invoice' });
      continue;
    }
    // The debtor said "already paid" or "this is wrong" on the payment page,
    // and nobody has reviewed it yet. Until someone does, this debt is
    // contested — resolution is one click on the invoices screen, and either
    // outcome (settled, or dismissed) puts the invoice back where it belongs.
    const reportKind = reportedInvoices.get(invoice.id);
    if (reportKind) {
      result.skipped.push({ invoiceId: invoice.id, reason: `open ${reportKind} report` });
      continue;
    }

    const rung = stepForInvoice(invoice.due_date, today, scenarioFor(invoice.id));
    if (!rung) continue;

    // Reachability is per step, not per debtor: a debtor with only a phone
    // number cannot receive the email-only step 1, and claiming a contact for
    // them would burn their one daily slot on a message nobody gets.
    //
    // The same reasoning covers an unconfigured provider. Claiming a contact is
    // irreversible — (invoice_id, step) is unique — so a step whose providers
    // are missing must be left untouched rather than claimed and then recorded
    // as failed. It will fire on a later run, once the keys exist.
    // The account switch belongs here, beside the other two reasons a channel
    // cannot carry this message. Applied only at delivery it was worse than
    // useless: the step was still claimed, nothing went out, the claim was
    // handed back, and the same step was retried on every run for as long as
    // the window stayed open.
    const reachable = enabledChannels(reachableChannels(rung.channels, debtor), tenant);
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

    // `stepAlreadySent` means the rung is already on file (by an earlier
    // run, or a concurrent worker) — nothing else will get through for them.
    if (outcome === 'contacted') {
      contactedThisRun.add(candidate.debtor.id);
    }
  }
}

type DeliveryOutcome = 'contacted' | 'stepAlreadySent' | 'skipped';

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
  const claim = {
    user_id: tenant.id,
    debtor_id: debtor.id,
    invoice_id: invoice.id,
    step,
    contact_on: today,
  };

  // The guarantee is now "once per invoice per cycle": a repeat of the final
  // step is a new cycle, and everything else is still cycle 0.
  let { data: contact, error: contactError } = await supabase
    .from('dunning_contacts')
    .insert({ ...claim, cycle: candidate.cycle })
    .select('id')
    .single();

  // PGRST204 means the column is not in the schema cache — this deployment is
  // running ahead of its migration. Claiming the row without a cycle is exactly
  // the behaviour from before repeats existed: the older unique index still
  // refuses a second send of the same step, so all that is lost is the repeat.
  // The alternative is every reminder failing to claim, which stops the ladder
  // dead for as long as the schema lags.
  if (contactError?.code === 'PGRST204' && (contactError.message ?? '').includes('cycle')) {
    console.warn('[dunning] dunning_contacts.cycle missing — migration not applied, repeats disabled');
    ({ data: contact, error: contactError } = await supabase
      .from('dunning_contacts')
      .insert(claim)
      .select('id')
      .single());
  }

  if (contactError || !contact) {
    // 23505 = unique_violation. Which index tripped decides what happens next,
    // so read the constraint name rather than guessing.
    if (contactError?.code === '23505') {

      result.skipped.push({
        invoiceId: invoice.id,
        reason: 'step already sent for this invoice',
      });
      return 'stepAlreadySent';
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

  if (sent.emailsSent === 0 && sent.smsSent === 0) {
    // Two different outcomes hide behind "nothing sent", and they need opposite
    // answers. The difference is whether a provider was actually asked.
    //
    // No errors means no attempt was made: every channel was skipped for a
    // stated reason, so nothing can have reached the debtor and the rung is
    // safe to hand back. Errors mean a provider was asked and did not confirm
    // — and a send that fails after the provider accepted it looks exactly the
    // same from here. Handing the claim back then is what turns one bad
    // minute into a message resent on every run for the rest of the day, now
    // that the one-a-day index is gone and nothing else caps it.
    //
    // So a failed attempt keeps its claim. The cost is a rung that may have
    // been missed and will not be retried; the alternative cost is a customer
    // receiving the same demand fifteen times. The failure is written to
    // communications_log either way, so it is visible in the message history
    // and the operator can send by hand.
    const attempted = sent.errors.length > 0;

    if (!attempted) {
      const { error: handBack } = await supabase
        .from('dunning_contacts')
        .delete()
        .eq('id', contact.id);

      if (handBack) {
        // The row survived, so the rung stays consumed whatever this says. Report
        // it as the failure it is rather than as a step left unspent.
        result.errors.push({
          invoiceId: invoice.id,
          error: `could not release the unspent claim: ${handBack.message}`,
        });
        return 'skipped';
      }

      result.contactsMade -= 1;
      result.skipped.push({
        invoiceId: invoice.id,
        reason: 'nothing attempted — step left unspent',
      });

      return 'skipped';
    }

    result.skipped.push({
      invoiceId: invoice.id,
      reason: 'delivery failed — step kept, not retried automatically',
    });

    return 'skipped';
  }

  return 'contacted';
}

/**
 * Whether a PostgREST failure is "that column is not there".
 *
 * Code is deployed from a branch; migrations are pushed by hand. The two land
 * minutes apart at best, and a `select` naming a column that has not arrived yet
 * does not degrade — it fails the whole query, so the caller gets `data: null`
 * and cannot tell "no rows" from "no column". For the bulk sender that reads as
 * every invoice having no due date, which it reports as failed.
 *
 * 42703 is undefined_column in Postgres. Matched on the code rather than the
 * message, which is human-facing text and localised.
 */
export function missingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703';
}
