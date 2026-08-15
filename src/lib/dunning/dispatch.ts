/**
 * Turning a claimed contact into actual messages.
 *
 * Split out of the engine because a manual "remind about payment" press has to
 * do exactly the same work as a ladder step once the contact row exists: same
 * templates, same credit accounting, same audit rows. Two copies of this would
 * drift, and the half that drifted would be the one nobody was testing.
 *
 * Everything here assumes the contact row is already claimed. Deciding *whether*
 * to contact — reachability, provider availability, the daily lock — happens
 * before this is called.
 */

import { sendEmail } from '@/lib/email/send';
import { appUrl } from '@/lib/env';
import { emailAvailable, smsAvailable, type Channel } from '@/lib/providers';
import { normalisePhone, sendSms } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, InvoiceRow, TemplateStep, UserRow } from '@/types/database';

import { renderEmail, renderSms, type TemplateContext, type TemplateOverrides } from './templates';

export interface DispatchOutcome {
  emailsSent: number;
  smsSent: number;
  /** Human-readable reasons a channel produced nothing. */
  skipped: string[];
  errors: string[];
}

/** How a document is named in a message: series + number, else MARK, else id. */
export function invoiceLabel(invoice: InvoiceRow): string {
  return (
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8)
  );
}

export function templateContext(
  tenant: UserRow,
  debtor: DebtorRow,
  invoice: InvoiceRow,
): TemplateContext {
  return {
    debtorName: debtor.name,
    creditorName: tenant.company_name ?? tenant.email,
    invoiceLabel: invoiceLabel(invoice),
    amountCents: invoice.amount_cents,
    currency: invoice.currency,
    dueDate: invoice.due_date,
    payUrl: `${appUrl()}/pay/${invoice.pay_token}`,
  };
}

export async function dispatchContact(params: {
  tenant: UserRow;
  debtor: DebtorRow;
  invoice: InvoiceRow;
  /**
   * The ladder step this contact *is*, recorded on every audit row. Null for a
   * manual reminder — the log must not claim a rung fired when none did.
   */
  step: TemplateStep;
  /**
   * The template to render with. Defaults to `step`. A manual send may borrow a
   * ladder step's wording, which changes the copy but not what it was: the
   * exact body transmitted is preserved in the log either way.
   */
  templateStep?: TemplateStep;
  /**
   * Null only when the contact limits are lifted for testing, in which case no
   * contact row exists to point at. The message is still logged.
   */
  contactId: string | null;
  channels: ReadonlyArray<Channel>;
  overrides: TemplateOverrides;
}): Promise<DispatchOutcome> {
  const { tenant, debtor, invoice, step, contactId, channels, overrides } = params;
  // `templateStep` may legitimately be null, so distinguish "not passed" from
  // "passed as null" rather than falling back with ??.
  const copyStep = params.templateStep !== undefined ? params.templateStep : step;
  const supabase = createAdminClient();
  const ctx = templateContext(tenant, debtor, invoice);

  const outcome: DispatchOutcome = { emailsSent: 0, smsSent: 0, skipped: [], errors: [] };

  const logRow = {
    user_id: tenant.id,
    debtor_id: debtor.id,
    invoice_id: invoice.id,
    contact_id: contactId,
    step,
  };

  if (channels.includes('email') && debtor.email) {
    const email = renderEmail(copyStep, ctx, overrides);

    if (!emailAvailable()) {
      // Reached only when another channel carried this contact — a step is never
      // claimed on the strength of an unconfigured provider.
      await supabase.from('communications_log').insert({
        ...logRow,
        channel: 'email',
        status: 'skipped',
        recipient: debtor.email,
        subject: email.subject,
        content: email.text,
        error: 'Email provider not configured',
      });
      outcome.skipped.push('email provider not configured');
    } else {
      const sent = await sendEmail({
        to: debtor.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        // The debtor owes the creditor, not the platform: the reminder should
        // read as coming from them.
        ...(tenant.company_name ? { fromName: tenant.company_name } : {}),
        ...(tenant.reply_to_email ? { replyTo: tenant.reply_to_email } : {}),
      });

      await supabase.from('communications_log').insert({
        ...logRow,
        channel: 'email',
        status: sent.ok ? 'sent' : 'failed',
        recipient: debtor.email,
        subject: email.subject,
        content: email.text,
        provider_message_id: sent.messageId ?? null,
        error: sent.error ?? null,
      });

      if (sent.ok) outcome.emailsSent += 1;
      else outcome.errors.push(`email: ${sent.error}`);
    }
  }

  const phone = normalisePhone(debtor.phone);
  if (channels.includes('sms') && phone) {
    const body = renderSms(copyStep, ctx, overrides);

    // Ask whether the provider exists *before* reserving a credit. Reserving
    // first would push every message through a reserve-then-refund cycle that
    // bills nothing but writes a bogus row into sms_credit_purchases each time.
    const smsReady = smsAvailable();

    // SMS costs a credit. Reserve it first so a provider success can never be
    // delivered without being paid for.
    const { data: hasCredit } = smsReady
      ? await supabase.rpc('consume_sms_credit', { p_user_id: tenant.id })
      : { data: false };

    if (!smsReady) {
      await supabase.from('communications_log').insert({
        ...logRow,
        channel: 'sms',
        status: 'skipped',
        recipient: phone,
        content: body,
        error: 'SMS provider not configured',
      });
      outcome.skipped.push('sms provider not configured');
    } else if (!hasCredit) {
      await supabase.from('communications_log').insert({
        ...logRow,
        channel: 'sms',
        status: 'skipped',
        recipient: phone,
        content: body,
        error: 'No SMS credits remaining',
      });
      outcome.skipped.push('out of SMS credits');
    } else {
      const sent = await sendSms({ phone, message: body });

      await supabase.from('communications_log').insert({
        ...logRow,
        channel: 'sms',
        status: sent.ok ? 'sent' : 'failed',
        recipient: phone,
        content: body,
        provider_message_id: sent.messageId ?? null,
        error: sent.error ?? null,
      });

      if (sent.ok) {
        outcome.smsSent += 1;
      } else {
        // Refund the reserved credit: nothing was delivered. The session id is
        // what makes the grant idempotent, so with no contact row to key on it
        // has to be unique per attempt — otherwise a second failed send would
        // hit the unique index and silently skip its refund.
        await supabase.rpc('grant_sms_credits', {
          p_user_id: tenant.id,
          p_credits: 1,
          p_amount_cents: 0,
          p_session_id: `refund:${contactId ?? crypto.randomUUID()}`,
        });
        outcome.errors.push(`sms: ${sent.error}`);
      }
    }
  }

  return outcome;
}
