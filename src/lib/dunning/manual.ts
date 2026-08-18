/**
 * "Remind about payment" — a reminder sent by hand from the invoice list.
 *
 * It is a real contact, so it respects the once-per-debtor-per-calendar-day
 * guarantee exactly like an automated one. That promise is the product's
 * compliance story and it says nothing about who pressed the button; a human
 * bypass would make it a claim we cannot stand behind.
 *
 * It does *not* consume a rung of the ladder. Nudging someone today must not
 * mean the invoice is never chased at step 2 later, so the contact row is
 * written with `manual = true` and a null step, which the partial unique index
 * on (invoice_id, step) ignores. This holds even when the operator picks a
 * ladder step's *wording*: the picker chooses copy, not ladder position.
 *
 * Preview and send share `loadTarget` and `resolveChannels` below. A preview
 * that computed its own answer would eventually disagree with the send, and the
 * whole point of a preview is that it tells the truth about what will happen.
 */

import { channelTaggedUrl } from '@/lib/funnel/events';
import { contactLimitsDisabled } from '@/lib/limits';
import { athensDate } from '@/lib/money';
import { channelAvailable, type Channel } from '@/lib/providers';
import { normalisePhone, segmentCount } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, InvoiceRow, TemplateStep, UserRow } from '@/types/database';

import { dispatchContact, templateContext } from './dispatch';
import { loadTemplateOverrides } from './template-store';
import { renderEmail, renderSms } from './templates';
import { getDictionary, type Dictionary } from '@/lib/i18n';

/**
 * Why a send did not happen, when the caller has to tell the reasons apart.
 *
 * A bulk send needs this: several invoices of the same customer will legitimately
 * hit the one-contact-per-day guarantee, and reporting that as a failure would
 * make a working safeguard look like a fault. Comparing the translated message
 * would work only until someone rewords it.
 */
export type ManualFailure = 'daily_limit';

export interface ManualReminderResult {
  ok: boolean;
  error?: string;
  code?: ManualFailure;
  emailsSent: number;
  smsSent: number;
  skipped: string[];
}

export interface ReminderPreview {
  ok: boolean;
  error?: string;
  subject?: string;
  emailBody?: string;
  smsBody?: string;
  smsSegments?: number;
  emailTo?: string | null;
  smsTo?: string | null;
  /** Channels that would actually carry the message if sent right now. */
  willSend?: Channel[];
  /** Why a channel is missing, or anything else worth knowing before sending. */
  notes?: string[];
}

interface Target {
  tenant: UserRow;
  debtor: DebtorRow;
  invoice: InvoiceRow;
}

function fail(error: string, code?: ManualFailure): ManualReminderResult {
  return { ok: false, error, code, emailsSent: 0, smsSent: 0, skipped: [] };
}

/**
 * Loads and validates the invoice, its debtor and the tenant.
 *
 * The admin client bypasses RLS, so every read is scoped by user_id explicitly —
 * this stands in for the policy that would otherwise do it.
 */
async function loadTarget(
  userId: string,
  invoiceId: string,
): Promise<{ ok: true; target: Target } | { ok: false; error: string }> {
  const t = await getDictionary();

  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!invoice) return { ok: false, error: t.manual.invoiceNotFound };
  if (invoice.status !== 'pending') {
    return { ok: false, error: t.manual.invoiceNotOpen };
  }

  const [{ data: debtor }, { data: tenant }] = await Promise.all([
    supabase.from('debtors').select('*').eq('id', invoice.debtor_id).maybeSingle(),
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
  ]);

  if (!debtor || !tenant) return { ok: false, error: t.manual.debtorMissing };

  // Muting is the auditable opt-out — disputes, payment plans, people who asked
  // not to be contacted. A manual send must not be the way around it.
  if (debtor.muted) {
    return {
      ok: false,
      error: t.manual.debtorMuted,
    };
  }

  return { ok: true, target: { tenant, debtor, invoice } };
}

/** Which channels can carry a message right now, and why the others cannot. */
function resolveChannels(
  debtor: DebtorRow,
  t: Dictionary,
): { channels: Channel[]; notes: string[] } {
  const notes: string[] = [];
  const channels: Channel[] = [];

  if (!debtor.email) notes.push(t.manual.noEmail);
  else if (!channelAvailable('email')) notes.push(t.manual.noEmailProvider);
  else channels.push('email');

  const phone = normalisePhone(debtor.phone);
  if (!phone) notes.push(t.manual.noPhone);
  else if (!channelAvailable('sms')) notes.push(t.manual.noSmsProvider);
  else channels.push('sms');

  return { channels, notes };
}

/** True when this debtor has already used up today's single contact. */
async function contactedToday(debtorId: string): Promise<boolean> {
  const { count } = await createAdminClient()
    .from('dunning_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('debtor_id', debtorId)
    .eq('contact_on', athensDate());

  return (count ?? 0) > 0;
}

/**
 * Renders what would be sent, without sending or claiming anything.
 *
 * Read-only by construction: it never touches dunning_contacts, so opening the
 * preview can never cost the debtor their one contact for the day.
 */
export async function previewManualReminder(params: {
  userId: string;
  invoiceId: string;
  step: TemplateStep;
}): Promise<ReminderPreview> {
  const t = await getDictionary();

  const loaded = await loadTarget(params.userId, params.invoiceId);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const { tenant, debtor, invoice } = loaded.target;
  const overrides = await loadTemplateOverrides(params.userId);
  const ctx = templateContext(tenant, debtor, invoice);

  // Tagged exactly as the send will be, so the preview tells the truth down to
  // the URL — including the four characters the tag costs an SMS segment.
  const email = renderEmail(
    params.step,
    { ...ctx, payUrl: channelTaggedUrl(ctx.payUrl, 'email') },
    overrides,
  );
  const sms = renderSms(
    params.step,
    { ...ctx, payUrl: channelTaggedUrl(ctx.payUrl, 'sms') },
    overrides,
  );

  const { channels, notes } = resolveChannels(debtor, t);

  if (contactLimitsDisabled()) {
    notes.push(t.manual.limitsOff);
  } else if (await contactedToday(debtor.id)) {
    notes.push(t.manual.alreadyContacted);
  }

  return {
    ok: true,
    subject: email.subject,
    emailBody: email.text,
    smsBody: sms,
    smsSegments: segmentCount(sms),
    emailTo: debtor.email,
    smsTo: normalisePhone(debtor.phone),
    willSend: channels,
    notes,
  };
}

export async function sendManualReminder(params: {
  userId: string;
  invoiceId: string;
  step: TemplateStep;
}): Promise<ManualReminderResult> {
  const t = await getDictionary();

  const { userId, invoiceId, step } = params;
  const supabase = createAdminClient();

  const loaded = await loadTarget(userId, invoiceId);
  if (!loaded.ok) return fail(loaded.error);

  const { tenant, debtor, invoice } = loaded.target;
  const { channels, notes } = resolveChannels(debtor, t);

  if (channels.length === 0) {
    return fail(notes.join(' ') || t.manual.noChannel);
  }

  // Claiming the row is what grants the right to contact this debtor today.
  //
  // With the testing flag on, nothing is claimed at all: the send goes out
  // unmetered and `dunning_contacts` is left untouched, so ladder bookkeeping is
  // identical to never having pressed the button. See lib/limits.ts.
  let contactId: string | null = null;

  if (!contactLimitsDisabled()) {
    const { data: contact, error: contactError } = await supabase
      .from('dunning_contacts')
      .insert({
        user_id: userId,
        debtor_id: debtor.id,
        invoice_id: invoice.id,
        // Null step and manual = true: this is a contact, not a rung. The chosen
        // wording above does not change that.
        step: null,
        manual: true,
        contact_on: athensDate(),
      })
      .select('id')
      .single();

    if (contactError || !contact) {
      if (contactError?.code === '23505') {
        return fail(t.manual.dailyLimit, 'daily_limit');
      }
      return fail(t.manual.contactFailed(contactError?.message ?? ''));
    }

    contactId = contact.id;
  }

  const outcome = await dispatchContact({
    tenant,
    debtor,
    invoice,
    // Logged as a manual contact whatever wording was picked, so the audit trail
    // never suggests a ladder step fired.
    step: null,
    templateStep: step,
    contactId,
    channels,
    overrides: await loadTemplateOverrides(userId),
  });

  return {
    ok: outcome.errors.length === 0,
    error: outcome.errors[0],
    emailsSent: outcome.emailsSent,
    smsSent: outcome.smsSent,
    skipped: outcome.skipped,
  };
}
