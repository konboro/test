import { athensDate, daysBetween } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InvoiceRow } from '@/types/database';

import { dispatchContact } from './dispatch';
import { loadScenario, automationPaused } from './engine';
import { overlayInvoiceMessages } from './invoice-messages';
import type { ScenarioNotice } from './scenario';
import { loadTarget } from './manual';
import { loadInvoiceMessages, loadTemplateOverrides } from './template-store';

/**
 * The message that goes out when an invoice is raised.
 *
 * Everything else in this directory chases a debt. This one does not: the
 * customer is not late, has not been asked for anything yet, and is being sent
 * a document they are expecting. That difference is why it is not a rung — it
 * takes no window on the ladder, spends none of the one-contact-per-day budget
 * that collections runs on, and cannot be caught up days later, because a
 * notice that an invoice "has been issued" is false a week after it was.
 *
 * What it shares with the ladder is everything about consent: a muted debtor is
 * still muted, a snoozed one still snoozed, a tenant with automation switched
 * off still sends nothing, and an invoice opted out of its scenario is opted out
 * of this too.
 */

export type IssueNoticeResult =
  | { sent: true }
  | { sent: false; reason: string };

/** Far enough past the due date that "your invoice has been issued" reads as a lie. */
const STALE_AFTER_DAYS = 0;

/**
 * Whether this invoice is owed a notice, and if not, why not.
 *
 * Pure, and separate from the sending, because these are the rules — every one
 * of them is a reason a message either reaches a customer or does not, and that
 * deserves to be readable and testable without a database behind it.
 */
export function issueNoticeDecision(input: {
  invoice: Pick<
    InvoiceRow,
    'status' | 'due_date' | 'automation_enabled' | 'scenario_mode' | 'issue_notice_sent_at'
  >;
  tenantAutomationEnabled: boolean;
  onIssue: ScenarioNotice;
  today: string;
}): { send: true } | { send: false; reason: string } {
  const { invoice, tenantAutomationEnabled, onIssue, today } = input;

  if (invoice.issue_notice_sent_at) return { send: false, reason: 'already sent' };
  if (invoice.status !== 'pending') return { send: false, reason: 'invoice not open' };

  if (invoice.scenario_mode === 'off' || automationPaused(invoice)) {
    return { send: false, reason: 'automation off for this invoice' };
  }

  if (!tenantAutomationEnabled) return { send: false, reason: 'automation off for the tenant' };
  if (!onIssue.enabled) return { send: false, reason: 'notice on issue is switched off' };
  if (onIssue.channels.length === 0) return { send: false, reason: 'no channel' };

  // An imported backlog is the common case: a debt loaded months after it was
  // raised belongs on the ladder, not announcing itself as new.
  if (daysBetween(invoice.due_date, today) > STALE_AFTER_DAYS) {
    return { send: false, reason: 'already past its due date' };
  }

  return { send: true };
}

/**
 * Sends the notice for one invoice, at most once, ever.
 *
 * The timestamp is claimed before anything is rendered. Two requests racing —
 * a double-clicked confirmation, or the sweep arriving while the action is
 * still running — both attempt the same conditional update, and only the one
 * that changes a row goes on to send.
 */
export async function sendIssueNotice(params: {
  userId: string;
  invoiceId: string;
}): Promise<IssueNoticeResult> {
  const { userId, invoiceId } = params;
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, user_id, due_date, status, automation_enabled, scenario_mode, issue_notice_sent_at')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!invoice) return { sent: false, reason: 'invoice not found' };

  const [{ data: tenant }, scenario] = await Promise.all([
    supabase.from('users').select('automation_enabled').eq('id', userId).maybeSingle(),
    loadScenario(userId),
  ]);

  const decision = issueNoticeDecision({
    invoice,
    tenantAutomationEnabled: Boolean(tenant?.automation_enabled),
    onIssue: scenario.onIssue,
    today: athensDate(),
  });

  if (!decision.send) return { sent: false, reason: decision.reason };

  // Mute, snooze and the invoice being open are all checked here, in the same
  // place the manual button checks them.
  const loaded = await loadTarget(userId, invoiceId);
  if (!loaded.ok) return { sent: false, reason: loaded.error };

  // The claim. Only one caller can win it, and losing it means somebody else is
  // already sending — so this returns rather than racing them.
  const { data: claimed } = await supabase
    .from('invoices')
    .update({ issue_notice_sent_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .is('issue_notice_sent_at', null)
    .select('id');

  if (!claimed?.length) return { sent: false, reason: 'already sent' };

  const outcome = await dispatchContact({
    tenant: loaded.target.tenant,
    debtor: loaded.target.debtor,
    invoice: loaded.target.invoice,
    step: 'on_issue',
    // Not a rung, so no contact row to point at and none of the daily budget
    // spent. The message is still written to the log like every other.
    contactId: null,
    channels: scenario.onIssue.channels,
    // The invoice's own wording laid over the account's, resolved here so the
    // dispatcher keeps seeing one set of templates. Precedence in one line:
    // invoice row, else account override, else built-in copy.
    overrides: overlayInvoiceMessages(
      await loadTemplateOverrides(userId),
      await loadInvoiceMessages(invoiceId),
    ),
  });

  if (outcome.emailsSent === 0 && outcome.smsSent === 0) {
    // Nothing left. Hand the claim back so the sweep can try again rather than
    // recording a notice the customer never received.
    await supabase
      .from('invoices')
      .update({ issue_notice_sent_at: null })
      .eq('id', invoiceId);

    return { sent: false, reason: outcome.errors.join('; ') || outcome.skipped.join('; ') || 'nothing sent' };
  }

  return { sent: true };
}

/**
 * Sends the notice without ever being the reason an invoice failed to save.
 *
 * Raising the invoice is the operator's work; telling the customer is ours. A
 * provider timing out must not come back as "could not create invoice" on a row
 * that was in fact created — so this swallows, says why in the log, and leaves
 * the notice unclaimed for the sweep to pick up.
 */
export async function noticeOnIssue(userId: string, invoiceId: string): Promise<void> {
  try {
    const result = await sendIssueNotice({ userId, invoiceId });
    if (!result.sent) {
      console.info('[issue-notice] not sent', { invoiceId, reason: result.reason });
    }
  } catch (cause) {
    console.error('[issue-notice]', invoiceId, String(cause));
  }
}

/**
 * Sends the notices that were missed.
 *
 * The send at confirmation time is the one that matters — it is what makes the
 * customer's copy arrive while the invoice is being raised. This is the safety
 * net for the times that did not happen: a provider outage, a deploy mid-request,
 * an invoice created by an import that predates this code.
 *
 * Bounded per run, and only recent invoices, because "your invoice has been
 * issued" stops being true quickly and a backlog is better left to the ladder.
 */
export async function sweepIssueNotices(userId: string, limit = 50): Promise<number> {
  const supabase = createAdminClient();

  const { data: pending } = await supabase
    .from('invoices')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .is('issue_notice_sent_at', null)
    .gte('due_date', athensDate())
    .order('created_at', { ascending: true })
    .limit(limit);

  let sent = 0;
  for (const invoice of pending ?? []) {
    const result = await sendIssueNotice({ userId, invoiceId: invoice.id });
    if (result.sent) sent += 1;
  }

  return sent;
}
