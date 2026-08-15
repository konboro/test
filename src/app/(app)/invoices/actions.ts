'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  previewManualReminder,
  sendManualReminder,
  type ReminderPreview,
} from '@/lib/dunning/manual';
import { parseReminderChoice } from '@/lib/dunning/templates';
import { toCents } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface InvoiceFormState {
  error?: string;
  success?: string;
}

export type ReminderState = InvoiceFormState;

/**
 * Sends a reminder for one invoice, on demand.
 *
 * Still bound by the once-per-debtor-per-day limit — see lib/dunning/manual.ts
 * — so this is a way to bring a reminder forward, not a way around the guarantee.
 */
export async function sendReminder(
  _prev: ReminderState,
  formData: FormData,
): Promise<ReminderState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Λείπει το παραστατικό.' };

  const step = parseReminderChoice(String(formData.get('choice') ?? 'manual'));
  if (step === undefined) return { error: 'Άγνωστο πρότυπο.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  const result = await sendManualReminder({ userId: user.id, invoiceId: id, step });

  revalidatePath('/invoices');
  revalidatePath('/logs');

  if (result.error) return { error: result.error };

  const delivered = [
    result.emailsSent > 0 ? 'email' : null,
    result.smsSent > 0 ? 'SMS' : null,
  ].filter(Boolean);

  if (delivered.length === 0) {
    // Nothing went out and nothing errored: a channel was skipped. Surface the
    // reason verbatim — during setup that is exactly what needs fixing.
    return { error: `Δεν στάλθηκε μήνυμα (${result.skipped.join(', ') || 'άγνωστος λόγος'}).` };
  }

  return { success: `Η υπενθύμιση στάλθηκε (${delivered.join(' + ')}).` };
}

/**
 * Renders what a reminder would look like for this invoice, without sending.
 *
 * Read-only: it never claims a contact, so opening the preview cannot cost the
 * debtor their one contact for the day.
 */
export async function previewReminder(
  invoiceId: string,
  choice: string,
): Promise<ReminderPreview> {
  const step = parseReminderChoice(choice);
  if (step === undefined) return { ok: false, error: 'Άγνωστο πρότυπο.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  return previewManualReminder({ userId: user.id, invoiceId, step });
}

/**
 * Records an off-platform settlement (bank transfer, cash).
 *
 * Settlement columns are not writable by browser sessions, so this runs through
 * the service role — after an explicit ownership check, which is what the RLS
 * policy would otherwise have done for us.
 */
export async function markInvoicePaid(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, amount_cents, status')
    .eq('id', id)
    .maybeSingle();

  // Ownership check stands in for the RLS policy bypassed by the service role.
  if (!invoice || invoice.user_id !== user.id || invoice.status !== 'pending') return;

  await admin
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_amount_cents: invoice.amount_cents,
    })
    .eq('id', id)
    .eq('status', 'pending');

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
}

const dueDateSchema = z.object({
  id: z.string().uuid(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Changes an invoice's due date.
 *
 * Worth having because the date is *derived*, not received: myDATA transmits an
 * issue date and nothing else, so every imported invoice gets issue date plus
 * the tenant's standard terms. When those terms do not apply — a payment plan, a
 * disputed document, an account that pays on receipt — the guess needs
 * correcting, and the due date is what the whole ladder keys off.
 *
 * Runs through the browser session rather than the service role: `due_date` is
 * one of the columns granted to `authenticated`, so RLS already confines this to
 * the tenant's own invoices.
 */
export async function updateDueDate(
  _prev: ReminderState,
  formData: FormData,
): Promise<ReminderState> {
  const parsed = dueDateSchema.safeParse({
    id: formData.get('id'),
    due_date: formData.get('due_date'),
  });

  if (!parsed.success) return { error: 'invalid' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('invoices')
    .update({ due_date: parsed.data.due_date })
    .eq('id', parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath('/invoices');
  revalidatePath('/debtors');
  revalidatePath('/dashboard');

  return { success: 'saved' };
}

const manualInvoice = z.object({
  debtor_id: z.string().uuid('Επιλέξτε πελάτη.'),
  invoice_number: z.string().trim().min(1, 'Ο αριθμός παραστατικού είναι υποχρεωτικός.').max(50),
  series: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
  amount: z.coerce.number().positive('Το ποσό πρέπει να είναι θετικό.'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Μη έγκυρη ημερομηνία έκδοσης.'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Μη έγκυρη ημερομηνία λήξης.'),
});

/** Creates an invoice by hand, for documents that never went through myDATA. */
export async function createInvoice(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const parsed = manualInvoice.safeParse({
    debtor_id: formData.get('debtor_id'),
    invoice_number: formData.get('invoice_number'),
    series: formData.get('series'),
    amount: formData.get('amount'),
    issue_date: formData.get('issue_date'),
    due_date: formData.get('due_date'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };

  if (parsed.data.due_date < parsed.data.issue_date) {
    return { error: 'Η ημερομηνία λήξης δεν μπορεί να προηγείται της έκδοσης.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  // RLS confirms the debtor belongs to this tenant: a foreign id simply returns
  // no rows here.
  const { data: debtor } = await supabase
    .from('debtors')
    .select('id')
    .eq('id', parsed.data.debtor_id)
    .maybeSingle();

  if (!debtor) return { error: 'Ο πελάτης δεν βρέθηκε.' };

  const { error } = await supabase.from('invoices').insert({
    user_id: user.id,
    debtor_id: parsed.data.debtor_id,
    invoice_number: parsed.data.invoice_number,
    series: parsed.data.series,
    amount_cents: toCents(parsed.data.amount),
    currency: 'EUR',
    issue_date: parsed.data.issue_date,
    due_date: parsed.data.due_date,
    mark: null,
    source: 'manual',
  });

  if (error) return { error: error.message };

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  return { success: 'Το παραστατικό καταχωρήθηκε.' };
}
