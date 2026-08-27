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
import type { Locale } from '@/lib/i18n/dictionaries';
import {
  overridesForLocale,
  resolveDebtorLocale,
  tenantLocale,
  type LanguageChoice,
} from '@/lib/i18n/message-locale';
import { contactLimitsDisabled } from '@/lib/limits';
import { athensDate, formatDate } from '@/lib/money';
import { channelAvailable, providerStatus, type Channel } from '@/lib/providers';
import { normalisePhone, segmentCount } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, InvoiceRow, TemplateStep, UserRow } from '@/types/database';

import { dispatchContact, templateContext } from './dispatch';
import { isSnoozed } from './snooze';
import { loadTemplateOverrides } from './template-store';
import { renderEmail, renderSms, type TemplateVariant } from './templates';
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
  /** The language this preview was rendered in, after resolving 'auto'. */
  locale?: Locale;
  /** True when the language came from the customer rather than the operator. */
  localeAuto?: boolean;
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
/**
 * The tenant, debtor and invoice a message is about, with every reason not to
 * send it already checked: the invoice open, the debtor neither muted nor
 * snoozed. Exported because the notice sent on issue has to make exactly the
 * same checks, and two copies of "may we contact this person" is one too many.
 */
export async function loadTarget(
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

  // Nor is the button a way around a promise. A snooze exists because someone
  // said "I'll pay on the 15th", and a reminder sent by hand on the 12th breaks
  // that just as surely as the sweep would. Lifting it is one click away and
  // says what it is doing, which is the honest way to change your mind.
  if (isSnoozed(debtor, athensDate())) {
    return {
      ok: false,
      error: t.manual.debtorSnoozed(formatDate(debtor.snoozed_until as string)),
    };
  }

  // The debtor contested this document from the payment page — claimed it is
  // paid, or disputed it — and the claim is still unreviewed. A reminder sent
  // by hand over the top of "I already paid" is the exact failure the report
  // exists to prevent; reviewing it is one click on the same screen.
  const { data: report } = await supabase
    .from('invoice_reports')
    .select('kind')
    .eq('invoice_id', invoice.id)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  if (report) {
    return {
      ok: false,
      error:
        report.kind === 'paid_claim' ? t.manual.invoicePaidClaim : t.manual.invoiceDisputed,
    };
  }

  return { ok: true, target: { tenant, debtor, invoice } };
}

/**
 * Narrows what is possible to what was asked for.
 *
 * The operator picks a channel for reasons the system cannot see — an SMS to
 * someone who never opens mail, email only for a customer who complained about
 * texts.  is a filter over what is available, never a way to force a
 * channel that is unavailable: asking for SMS alone when there is no number
 * still sends nothing, and says so.
 */
export type ChannelChoice = 'both' | 'email' | 'sms';

export function narrowChannels(available: Channel[], only: ChannelChoice): Channel[] {
  return only === 'both' ? available : available.filter((c) => c === only);
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
  variant?: TemplateVariant;
  only?: ChannelChoice;
  language?: LanguageChoice;
}): Promise<ReminderPreview> {
  const t = await getDictionary();

  const loaded = await loadTarget(params.userId, params.invoiceId);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const { tenant, debtor, invoice } = loaded.target;
  const ctx = templateContext(tenant, debtor, invoice);

  // The same resolution the send performs, so the preview cannot show one
  // language and post another.
  const authoredIn = tenantLocale(tenant);
  const language = params.language ?? 'auto';
  const locale = language === 'auto' ? resolveDebtorLocale(debtor, authoredIn) : language;
  const overrides = overridesForLocale(
    await loadTemplateOverrides(params.userId),
    locale,
    authoredIn,
  );

  // Tagged exactly as the send will be, so the preview tells the truth down to
  // the URL — including the four characters the tag costs an SMS segment.
  const email = renderEmail(
    params.step,
    { ...ctx, payUrl: channelTaggedUrl(ctx.payUrl, 'email') },
    overrides,
    params.variant ?? null,
    locale,
  );
  const sms = renderSms(
    params.step,
    { ...ctx, payUrl: channelTaggedUrl(ctx.payUrl, 'sms') },
    overrides,
    params.variant ?? null,
    locale,
  );

  const { channels: available, notes } = resolveChannels(debtor, t);
  // What the operator asked for, narrowed to what is actually possible.
  const channels = narrowChannels(available, params.only ?? 'both');

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
    locale,
    localeAuto: language === 'auto',
  };
}

export async function sendManualReminder(params: {
  userId: string;
  invoiceId: string;
  step: TemplateStep;
  variant?: TemplateVariant;
  only?: ChannelChoice;
  language?: LanguageChoice;
}): Promise<ManualReminderResult> {
  const t = await getDictionary();

  const { userId, invoiceId, step } = params;
  const supabase = createAdminClient();

  const loaded = await loadTarget(userId, invoiceId);
  if (!loaded.ok) {
    console.error('[manual:refused] loadTarget', { invoiceId, reason: loaded.error });
    return fail(loaded.error);
  }

  const { tenant, debtor, invoice } = loaded.target;
  const { channels: available, notes } = resolveChannels(debtor, t);
  // What the operator asked for, narrowed to what is actually possible.
  const channels = narrowChannels(available, params.only ?? 'both');

  if (channels.length === 0) {
    console.error('[manual:refused] no channel', {
      invoiceId,
      notes,
      hasEmail: Boolean(debtor.email),
      hasPhone: Boolean(debtor.phone),
      providers: providerStatus(),
    });
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
    templateVariant: params.variant ?? null,
    contactId,
    channels,
    overrides: await loadTemplateOverrides(userId),
    // Undefined lets dispatch resolve it from the customer, which is what the
    // automatic sweep does too. 'auto' here would be a value meaning the same
    // thing in a second place.
    locale: params.language && params.language !== 'auto' ? params.language : undefined,
  });

  return {
    ok: outcome.errors.length === 0,
    error: outcome.errors[0],
    emailsSent: outcome.emailsSent,
    smsSent: outcome.smsSent,
    skipped: outcome.skipped,
  };
}
