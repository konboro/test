import { tenantLocale } from '@/lib/i18n/message-locale';
import { createAdminClient } from '@/lib/supabase/admin';

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
/**
 * The language a company's own wording is written in.
 *
 * Read with the service role because every caller here already is: this runs
 * inside the sweep as well as behind the panel, and the sweep has no session to
 * resolve a policy against.
 */
async function accountLocale(userId: string) {
  const { data } = await createAdminClient()
    .from('users')
    .select('locale')
    .eq('id', userId)
    .maybeSingle();

  return tenantLocale({ locale: data?.locale ?? null });
}

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
 * override where one exists, the built-in copy in the account's own language
 * where not. This is what the quick editor prefills, and what a submission is
 * compared against to decide whether it is an override at all.
 *
 * The language is read here rather than passed in, and it is the language
 * stored on the company — not the one in the reader's cookie. Every caller used
 * to hand over `getLocale()`, which is the person's interface language, and the
 * two part company exactly where this product expects them to: an accountant
 * working in English inside a Greek client's books.
 *
 * What went wrong when they parted: the editor prefilled the English built-in
 * text, so anything the accountant typed counted as an override and was stored.
 * At send time the gate is `tenantLocale` — the account's language — so
 * `overridesForLocale` saw copy authored in another language and discarded it.
 * The built-in Greek went out instead, and the screen had said "saved".
 */
export async function effectiveNoticeTexts(userId: string): Promise<NoticeTexts> {
  const [overrides, locale] = await Promise.all([
    loadTemplateOverrides(userId),
    accountLocale(userId),
  ]);

  const email = overrides['on_issue:email'] ?? defaultTemplateFor('on_issue:email', locale);
  const sms = overrides['on_issue:sms'] ?? defaultTemplateFor('on_issue:sms', locale);

  return {
    emailSubject: email.subject ?? '',
    emailBody: email.body,
    smsBody: sms.body,
  };
}
