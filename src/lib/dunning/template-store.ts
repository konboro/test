import { createAdminClient } from '@/lib/supabase/admin';
import type { UserLocale } from '@/types/database';

import type { InvoiceMessageInput, NoticeTexts } from './invoice-messages';
import { defaultTemplateFor, slotKey, type TemplateOverrides, type TemplateVariant } from './templates';

/**
 * A tenant's template overrides, keyed by slot.
 *
 * Loaded once per tenant per sweep rather than per message: a tenant with two
 * hundred overdue invoices has exactly one set of templates, and reading them
 * back for every send would turn a cheap lookup into the bulk of the run.
 *
 * A tenant with no overrides yields an empty object, and every render falls back
 * to the built-in copy.
 */
export async function loadTemplateOverrides(userId: string): Promise<TemplateOverrides> {
  const { data } = await createAdminClient()
    .from('message_templates')
    // Every column rather than a named list, so that naming `variant` cannot
    // fail against a database that has not taken the migration yet. Asking for
    // a column that does not exist fails the whole request, and the empty
    // result reads as "this tenant has no overrides" — every customised
    // template would quietly revert to the built-in copy until the schema
    // caught up. A tenant has a handful of rows here; the extra columns cost
    // nothing worth that.
    .select('*')
    .eq('user_id', userId);

  const overrides: TemplateOverrides = {};

  for (const row of data ?? []) {
    overrides[slotKey(row.step, row.channel, row.variant as TemplateVariant)] = {
      subject: row.subject,
      body: row.body,
    };
  }

  return overrides;
}

/**
 * One invoice's own wording, or nothing.
 *
 * Tolerant of the table not existing yet: deploys and migrations do not land
 * together, and a missing override table means "no invoice has its own
 * wording" — which is exactly what the account template is for. The warning is
 * what tells an operator reading the logs why an edit they made is not going
 * out.
 */
export async function loadInvoiceMessages(invoiceId: string): Promise<InvoiceMessageInput[]> {
  const { data, error } = await createAdminClient()
    .from('invoice_messages')
    .select('*')
    .eq('invoice_id', invoiceId);

  if (error) {
    console.warn('[templates] invoice_messages unreadable — migration not applied yet?', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    step: row.step,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
  }));
}

/**
 * The account's effective wording for the notice on issue: the tenant's
 * override where one exists, the built-in copy in the reader's language where
 * not. This is what the quick editor prefills, and what a submission is
 * compared against to decide whether it is an override at all.
 */
export async function effectiveNoticeTexts(
  userId: string,
  locale: UserLocale,
): Promise<NoticeTexts> {
  const overrides = await loadTemplateOverrides(userId);

  const email = overrides['on_issue:email'] ?? defaultTemplateFor('on_issue:email', locale);
  const sms = overrides['on_issue:sms'] ?? defaultTemplateFor('on_issue:sms', locale);

  return {
    emailSubject: email.subject ?? '',
    emailBody: email.body,
    smsBody: sms.body,
  };
}
