'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  previewManualReminder,
  sendManualReminder,
  type ReminderPreview,
} from '@/lib/dunning/manual';
import { parseReminderChoice } from '@/lib/dunning/templates';
import { athensDate, toCents } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formError, getDictionary } from '@/lib/i18n';
import { redirect } from 'next/navigation';
import { loadScenario, stepForInvoice } from '@/lib/dunning/engine';

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
  const t = await getDictionary();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: t.forms.errors.missingInvoice };

  const step = parseReminderChoice(String(formData.get('choice') ?? 'manual'));
  if (step === undefined) return { error: t.forms.errors.unknownTemplate };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

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
    return { error: t.forms.errors.reminderNotSent(result.skipped.join(', ') || t.forms.errors.unknownReason) };
  }

  return { success: t.forms.success.reminderSent(delivered.join(' + ')) };
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
  const t = await getDictionary();

  const step = parseReminderChoice(choice);
  if (step === undefined) return { ok: false, error: t.forms.errors.unknownTemplate };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: t.forms.errors.unauthorized };

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
  debtor_id: z.string().uuid('chooseCustomer'),
  invoice_number: z.string().trim().min(1, 'invoiceNumberRequired').max(50),
  series: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
  amount: z.coerce.number().positive('amountPositive'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidIssueDate'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDueDate'),
});

/** Creates an invoice by hand, for documents that never went through myDATA. */
export async function createInvoice(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const t = await getDictionary();

  const parsed = manualInvoice.safeParse({
    debtor_id: formData.get('debtor_id'),
    invoice_number: formData.get('invoice_number'),
    series: formData.get('series'),
    amount: formData.get('amount'),
    issue_date: formData.get('issue_date'),
    due_date: formData.get('due_date'),
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  if (parsed.data.due_date < parsed.data.issue_date) {
    return { error: t.forms.errors.dueBeforeIssue };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  // RLS confirms the debtor belongs to this tenant: a foreign id simply returns
  // no rows here.
  const { data: debtor } = await supabase
    .from('debtors')
    .select('id')
    .eq('id', parsed.data.debtor_id)
    .maybeSingle();

  if (!debtor) return { error: t.forms.errors.debtorNotFound };

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
  return { success: t.forms.success.invoiceCreated };
}


/**
 * How many invoices one press may send to.
 *
 * Each send is an email and an SMS against live providers, so an unbounded loop
 * would sit past the request timeout and leave nobody knowing what went out. The
 * remainder is reported rather than dropped quietly — the count comes back in
 * the redirect so the operator can select the rest and go again.
 */
const BULK_LIMIT = 50;

/**
 * Sends the same reminder to every selected invoice.
 *
 * Deliberately the same path as the single send: `sendManualReminder` claims a
 * contact row before it delivers anything, so the once-per-debtor-per-day
 * guarantee holds across a bulk press exactly as it does for one. Selecting five
 * invoices of the same customer therefore sends one reminder and reports four as
 * limited — that is the safeguard working, not a failure, and the summary keeps
 * the two apart.
 */
export async function sendBulkReminder(formData: FormData): Promise<void> {
  const ids = formData.getAll('ids').map(String).filter(Boolean);
  const back = String(formData.get('back') ?? '/invoices');
  const step = parseReminderChoice(String(formData.get('choice') ?? 'manual'));

  const to = (params: Record<string, string | number>) => {
    const query = new URLSearchParams(back.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${back.split('?')[0]}?${query}`;
  };

  // A bulk press that selects nothing looks identical to one that fails: both
  // redirect instantly and change nothing. Say which it was.
  console.info('[bulk] pressed', { ids: ids.length, back });
  if (!ids.length) redirect(to({ bulk: 'none' }));
  if (step === undefined) redirect(to({ bulk: 'unknown_template' }));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const batch = ids.slice(0, BULK_LIMIT);
  let sent = 0;
  let limited = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential on purpose. The daily guarantee is enforced by a unique index, so
  // concurrent sends to one customer would race each other into it and the
  // outcome would depend on who lost.
  for (const id of batch) {
    const result = await sendManualReminder({ userId: user.id, invoiceId: id, step });

    if (result.error) {
      if (result.code === 'daily_limit') limited += 1;
      else failed += 1;
      continue;
    }

    if (result.emailsSent + result.smsSent > 0) sent += 1;
    else skipped += 1;
  }

  revalidatePath('/invoices');
  revalidatePath('/logs');

  redirect(
    to({
      bulk: 'done',
      sent,
      limited,
      skipped,
      failed,
      left: Math.max(0, ids.length - batch.length),
    }),
  );
}


/**
 * Sends whatever the scenario says is due today, for each selected invoice.
 *
 * Different from picking a template by hand: nothing is chosen, the cadence
 * decides. An invoice that has not reached a step yet is reported as such rather
 * than being sent something arbitrary.
 *
 * It goes out as a manual contact, which in this product deliberately does not
 * consume a rung of the automatic ladder — bringing a message forward must not
 * cancel the scheduled one. So the sweep will still send that step on its own
 * day, and the once-per-debtor-per-day guarantee is what stops the two landing
 * together.
 */
export async function runScenarioForSelected(formData: FormData): Promise<void> {
  const ids = formData.getAll('ids').map(String).filter(Boolean);
  const back = String(formData.get('back') ?? '/invoices');

  const to = (params: Record<string, string | number>) => {
    const query = new URLSearchParams(back.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${back.split('?')[0]}?${query}`;
  };

  if (!ids.length) redirect(to({ bulk: 'none' }));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const batch = ids.slice(0, BULK_LIMIT);
  const scenario = await loadScenario(user.id);
  const today = athensDate();

  const { data: rows } = await supabase
    .from('invoices')
    .select('id, due_date')
    .eq('user_id', user.id)
    .in('id', batch);

  const dueDates = new Map((rows ?? []).map((row) => [row.id, row.due_date]));

  let sent = 0;
  let limited = 0;
  let skipped = 0;
  let failed = 0;
  let notDue = 0;

  for (const id of batch) {
    const dueDate = dueDates.get(id);
    if (!dueDate) {
      failed += 1;
      continue;
    }

    const rung = stepForInvoice(dueDate, today, scenario);
    if (!rung) {
      notDue += 1;
      continue;
    }

    const result = await sendManualReminder({ userId: user.id, invoiceId: id, step: rung.step });

    if (result.error) {
      if (result.code === 'daily_limit') limited += 1;
      else failed += 1;
      continue;
    }

    if (result.emailsSent + result.smsSent > 0) sent += 1;
    else skipped += 1;
  }

  revalidatePath('/invoices');
  revalidatePath('/logs');

  redirect(
    to({
      bulk: 'done',
      sent,
      limited,
      skipped,
      failed,
      notDue,
      left: Math.max(0, ids.length - batch.length),
    }),
  );
}
