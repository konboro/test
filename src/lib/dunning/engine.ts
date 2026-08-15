import { sendEmail } from '@/lib/email/send';
import { appUrl } from '@/lib/env';
import { athensDate, daysBetween } from '@/lib/money';
import {
  channelAvailable,
  emailAvailable,
  providerStatus,
  smsAvailable,
  type Channel,
  type ProviderStatus,
} from '@/lib/providers';
import { normalisePhone, sendSms } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, DunningStep, InvoiceRow, UserRow } from '@/types/database';

import { renderEmail, renderSms, type TemplateContext } from './templates';

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

/** Stop chasing entirely once an invoice is this far past due. */
const ABANDON_AFTER_DAYS = 120;

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
export function stepForInvoice(dueDate: string, today: string) {
  const daysOverdue = daysBetween(dueDate, today);

  if (daysOverdue > ABANDON_AFTER_DAYS) return null;

  for (const rung of LADDER) {
    if (daysOverdue >= rung.offsetFrom && daysOverdue <= rung.offsetUntil) {
      return { ...rung, daysOverdue };
    }
  }
  return null;
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

    const rung = stepForInvoice(invoice.due_date, today);
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

  for (const candidate of candidates) {
    if (contactedThisRun.has(candidate.debtor.id)) continue;

    const outcome = await deliver(tenant, candidate, today, result, dryRun);

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

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  const ctx: TemplateContext = {
    debtorName: debtor.name,
    creditorName: tenant.company_name ?? tenant.email,
    invoiceLabel: label,
    amountCents: invoice.amount_cents,
    currency: invoice.currency,
    dueDate: invoice.due_date,
    payUrl: `${appUrl()}/pay/${invoice.pay_token}`,
  };

  if (candidate.channels.includes('email') && debtor.email && !emailAvailable()) {
    // Reached only when another channel carried this contact — the step itself
    // was never claimed on the strength of an unconfigured provider.
    await supabase.from('communications_log').insert({
      user_id: tenant.id,
      debtor_id: debtor.id,
      invoice_id: invoice.id,
      contact_id: contact.id,
      channel: 'email',
      step,
      status: 'skipped',
      recipient: debtor.email,
      content: renderEmail(step, ctx).text,
      error: 'Email provider not configured',
    });
    result.skipped.push({ invoiceId: invoice.id, reason: 'email provider not configured' });
  } else if (candidate.channels.includes('email') && debtor.email) {
    const email = renderEmail(step, ctx);
    const sent = await sendEmail({
      to: debtor.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(tenant.reply_to_email ? { replyTo: tenant.reply_to_email } : {}),
    });

    await supabase.from('communications_log').insert({
      user_id: tenant.id,
      debtor_id: debtor.id,
      invoice_id: invoice.id,
      contact_id: contact.id,
      channel: 'email',
      step,
      status: sent.ok ? 'sent' : 'failed',
      recipient: debtor.email,
      subject: email.subject,
      content: email.text,
      provider_message_id: sent.messageId ?? null,
      error: sent.error ?? null,
    });

    if (sent.ok) result.emailsSent += 1;
    else result.errors.push({ invoiceId: invoice.id, error: `email: ${sent.error}` });
  }

  const phone = normalisePhone(debtor.phone);
  if (candidate.channels.includes('sms') && phone) {
    const body = renderSms(step, ctx);

    // Ask whether the provider exists *before* reserving a credit. Reserving
    // first would push every message through a reserve-then-refund cycle that
    // bills nothing but writes a bogus row into the purchase ledger each time.
    const smsReady = smsAvailable();

    // SMS costs a credit. Reserve it first so a provider success can never be
    // delivered without being paid for.
    const { data: hasCredit } = smsReady
      ? await supabase.rpc('consume_sms_credit', { p_user_id: tenant.id })
      : { data: false };

    if (!smsReady) {
      await supabase.from('communications_log').insert({
        user_id: tenant.id,
        debtor_id: debtor.id,
        invoice_id: invoice.id,
        contact_id: contact.id,
        channel: 'sms',
        step,
        status: 'skipped',
        recipient: phone,
        content: body,
        error: 'SMS provider not configured',
      });
      result.skipped.push({ invoiceId: invoice.id, reason: 'sms provider not configured' });
    } else if (!hasCredit) {
      await supabase.from('communications_log').insert({
        user_id: tenant.id,
        debtor_id: debtor.id,
        invoice_id: invoice.id,
        contact_id: contact.id,
        channel: 'sms',
        step,
        status: 'skipped',
        recipient: phone,
        content: body,
        error: 'No SMS credits remaining',
      });
      result.skipped.push({ invoiceId: invoice.id, reason: 'out of SMS credits' });
    } else {
      const sent = await sendSms({ phone, message: body });

      await supabase.from('communications_log').insert({
        user_id: tenant.id,
        debtor_id: debtor.id,
        invoice_id: invoice.id,
        contact_id: contact.id,
        channel: 'sms',
        step,
        status: sent.ok ? 'sent' : 'failed',
        recipient: phone,
        content: body,
        provider_message_id: sent.messageId ?? null,
        error: sent.error ?? null,
      });

      if (sent.ok) {
        result.smsSent += 1;
      } else {
        // Refund the reserved credit: nothing was delivered.
        await supabase.rpc('grant_sms_credits', {
          p_user_id: tenant.id,
          p_credits: 1,
          p_amount_cents: 0,
          p_session_id: `refund:${contact.id}`,
        });
        result.errors.push({ invoiceId: invoice.id, error: `sms: ${sent.error}` });
      }
    }
  }

  return 'contacted';
}
