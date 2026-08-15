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
 * on (invoice_id, step) ignores.
 */

import { athensDate } from '@/lib/money';
import { channelAvailable, type Channel } from '@/lib/providers';
import { normalisePhone } from '@/lib/sms/send';
import { createAdminClient } from '@/lib/supabase/admin';

import { dispatchContact } from './dispatch';
import { loadTemplateOverrides } from './template-store';

export interface ManualReminderResult {
  ok: boolean;
  error?: string;
  emailsSent: number;
  smsSent: number;
  skipped: string[];
}

function fail(error: string): ManualReminderResult {
  return { ok: false, error, emailsSent: 0, smsSent: 0, skipped: [] };
}

export async function sendManualReminder(params: {
  userId: string;
  invoiceId: string;
}): Promise<ManualReminderResult> {
  const { userId, invoiceId } = params;
  const supabase = createAdminClient();

  // The admin client bypasses RLS, so scope every read by user_id explicitly —
  // this stands in for the policy that would otherwise do it.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!invoice) return fail('Το παραστατικό δεν βρέθηκε.');
  if (invoice.status !== 'pending') {
    return fail('Το παραστατικό δεν είναι ανεξόφλητο — δεν στάλθηκε υπενθύμιση.');
  }

  const [{ data: debtor }, { data: tenant }] = await Promise.all([
    supabase.from('debtors').select('*').eq('id', invoice.debtor_id).maybeSingle(),
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
  ]);

  if (!debtor || !tenant) return fail('Δεν βρέθηκαν τα στοιχεία του πελάτη.');

  // Muting is the auditable opt-out — disputes, payment plans, people who asked
  // not to be contacted. A manual send must not be the way around it.
  if (debtor.muted) {
    return fail('Ο πελάτης είναι σε σίγαση. Καταργήστε τη σίγαση για να στείλετε υπενθύμιση.');
  }

  const reachable: Channel[] = [];
  if (debtor.email) reachable.push('email');
  if (normalisePhone(debtor.phone)) reachable.push('sms');

  if (reachable.length === 0) {
    return fail('Ο πελάτης δεν έχει email ούτε έγκυρο κινητό τηλέφωνο.');
  }

  const channels = reachable.filter(channelAvailable);
  if (channels.length === 0) {
    return fail(
      'Δεν έχει ρυθμιστεί πάροχος αποστολής. Προσθέστε κλειδί Resend ή Yuboto και δοκιμάστε ξανά.',
    );
  }

  // Claiming the row is what grants the right to contact this debtor today.
  const { data: contact, error: contactError } = await supabase
    .from('dunning_contacts')
    .insert({
      user_id: userId,
      debtor_id: debtor.id,
      invoice_id: invoice.id,
      step: null,
      manual: true,
      contact_on: athensDate(),
    })
    .select('id')
    .single();

  if (contactError || !contact) {
    if (contactError?.code === '23505') {
      return fail(
        'Ο πελάτης έχει ήδη ειδοποιηθεί σήμερα. Επιτρέπεται μία επικοινωνία ανά ημέρα.',
      );
    }
    return fail(`Δεν ήταν δυνατή η καταχώριση της επικοινωνίας: ${contactError?.message ?? ''}`);
  }

  const outcome = await dispatchContact({
    tenant,
    debtor,
    invoice,
    step: null,
    contactId: contact.id,
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
