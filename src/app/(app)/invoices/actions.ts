'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  previewManualReminder,
  sendManualReminder,
  type ChannelChoice,
  type ReminderPreview,
} from '@/lib/dunning/manual';
import { parseReminderSlot } from '@/lib/dunning/templates';
import { parseLanguageChoice } from '@/lib/i18n/message-locale';
import { athensDate, toCents } from '@/lib/money';
import { safeNextPath } from '@/lib/redirects';
import { activeOrganization, writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { saveFailed } from '@/lib/errors';
import { formError, getDictionary } from '@/lib/i18n';
import { redirect } from 'next/navigation';
import { automationPaused, loadScenario, missingColumn, stepForInvoice } from '@/lib/dunning/engine';
import { noticeOnIssue } from '@/lib/dunning/issue-notice';
import { invoiceScenarioProblem, parseInvoiceScenario } from '@/lib/dunning/invoice-scenario';
import type { InvoiceScenarioMode } from '@/types/database';
import { contactedOn, LOOKBACK_HOURS } from '@/lib/dunning/already-contacted';
import { planBulkSend } from '@/lib/dunning/bulk-plan';
import { DEFAULT_TIMEZONE, zonedDate } from '@/lib/money';

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
/** Anything unrecognised means both — the safe reading of a stale form. */
function channelChoice(value: unknown): ChannelChoice {
  return value === 'email' || value === 'sms' ? value : 'both';
}

export async function sendReminder(
  _prev: ReminderState,
  formData: FormData,
): Promise<ReminderState> {
  const t = await getDictionary();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: t.forms.errors.missingInvoice };

  const slot = parseReminderSlot(String(formData.get('choice') ?? 'manual'));
  if (!slot) return { error: t.forms.errors.unknownTemplate };

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const result = await sendManualReminder({
    userId: org.id,
    invoiceId: id,
    step: slot.step,
    variant: slot.variant,
    only: channelChoice(formData.get('only')),
    language: parseLanguageChoice(formData.get('lang')),
  });

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
  only?: string,
  lang?: string,
): Promise<ReminderPreview> {
  const t = await getDictionary();

  const slot = parseReminderSlot(choice);
  if (!slot) return { ok: false, error: t.forms.errors.unknownTemplate };

  // Reading, not sending: a viewer may look at what would go out. The send
  // itself is a different action and asks for a role that can write.
  const org = await activeOrganization();
  if (!org) return { ok: false, error: t.forms.errors.unauthorized };

  return previewManualReminder({
    userId: org.id,
    invoiceId,
    step: slot.step,
    variant: slot.variant,
    only: channelChoice(only),
    language: parseLanguageChoice(lang),
  });
}

/**
 * Records an off-platform settlement (bank transfer, cash).
 *
 * Settlement columns are not writable by browser sessions, so this runs through
 * the service role — after an explicit ownership check, which is what the RLS
 * policy would otherwise have done for us.
 */
/**
 * Switches the automatic chasing on or off for one invoice.
 *
 * Written through the session client rather than the service role, unlike the
 * settlement fields beside it: this is a preference about the tenant's own
 * document, and the migration grants exactly this column to `authenticated`.
 * RLS decides whose invoice it is, which is the check that matters.
 *
 * It governs the sweep only. The reminder button on the same row keeps working
 * while an invoice is paused — pausing says "stop chasing this on your own",
 * not "refuse me when I ask".
 */
export async function toggleInvoiceAutomation(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // The row sends what it is showing, so the button flips what the operator
  // actually saw rather than re-reading a value that may have moved.
  const enabled = String(formData.get('enabled') ?? '') === 'true';

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return;

  await supabase.from('invoices').update({ automation_enabled: !enabled }).eq('id', id);

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
}

export async function markInvoicePaid(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const org = await writableOrganization();
  if (!org) return;

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, amount_cents, status')
    .eq('id', id)
    .maybeSingle();

  // Ownership check stands in for the RLS policy bypassed by the service role.
  if (!invoice || invoice.user_id !== org.id || invoice.status !== 'pending') return;

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


/**
 * Deletes one invoice.
 *
 * The row goes and takes its payment attempts, its link activity and its rung
 * bookkeeping with it — those cascade in the schema. Messages already sent
 * survive: `communications_log.invoice_id` is set null rather than cascaded, so
 * the record of what was said to a customer outlives the document it was about.
 * That asymmetry is deliberate and worth keeping.
 *
 * Runs under the service role, so the ownership check here is doing the work RLS
 * would otherwise do. `confirm` is required because a delete should not be one
 * stray request away; only the dialog sets it.
 */
export async function deleteInvoice(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const t = await getDictionary();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: t.forms.errors.missingInvoice };
  if (formData.get('confirm') !== 'yes') return { error: t.forms.errors.missingInvoice };

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!invoice || invoice.user_id !== org.id) return { error: t.forms.errors.missingInvoice };

  const { error } = await admin.from('invoices').delete().eq('id', id).eq('user_id', org.id);
  if (error) return { error: saveFailed(t, 'invoices', error) };

  revalidatePath('/invoices');
  revalidatePath('/debtors');
  revalidatePath('/dashboard');

  return { ok: true };
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
  const t = await getDictionary();

  const parsed = dueDateSchema.safeParse({
    id: formData.get('id'),
    due_date: formData.get('due_date'),
  });

  // A sentence, not the token `invalid`. The component used to translate that
  // token itself, which meant one action reported failure in a private
  // vocabulary only one caller understood — and any other caller would have
  // shown the word `invalid` to a Greek reader.
  if (!parsed.success) return { error: t.invoices.dueDateInvalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from('invoices')
    .update({ due_date: parsed.data.due_date })
    .eq('id', parsed.data.id);

  if (error) return { error: saveFailed(t, 'invoices', error) };

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
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  // RLS confirms the debtor belongs to this tenant: a foreign id simply returns
  // no rows here.
  const { data: debtor } = await supabase
    .from('debtors')
    .select('id')
    .eq('id', parsed.data.debtor_id)
    .maybeSingle();

  if (!debtor) return { error: t.forms.errors.debtorNotFound };

  // What the operator chose beside the invoice, read before anything is
  // written: a cadence the database would refuse should not leave an invoice
  // saved with a mode it does not match.
  const cadence = parseInvoiceScenario(formData, await loadScenario(org.id));
  const problem = invoiceScenarioProblem(cadence);
  if (problem) return { error: t.scenario[problem] };

  const base = {
      user_id: org.id,
      debtor_id: parsed.data.debtor_id,
      invoice_number: parsed.data.invoice_number,
      series: parsed.data.series,
      amount_cents: toCents(parsed.data.amount),
      currency: 'EUR',
      issue_date: parsed.data.issue_date,
      due_date: parsed.data.due_date,
    mark: null,
    source: 'manual' as const,
    // Kept in step with the mode, because the row switch has always written
    // this one and the two disagreeing would mean the invoice is chased or not
    // depending on which the reader happened to look at.
    automation_enabled: cadence.mode !== 'off',
  };

  const write = (row: typeof base & { scenario_mode?: InvoiceScenarioMode }) =>
    supabase.from('invoices').insert(row).select('id').maybeSingle();

  let { data: created, error } = await write({ ...base, scenario_mode: cadence.mode });

  // Deploys and migrations do not land together. Raising an invoice is the
  // work; the cadence column is how we describe it afterwards, and the absence
  // of the column must not take the work down with it. The invoice is saved
  // without it and follows the account scenario, which is the default anyway.
  if (missingColumn(error)) {
    console.warn('[invoices] scenario_mode column absent — migration not applied yet');
    ({ data: created, error } = await write(base));
  }

  if (error) return { error: saveFailed(t, 'invoices', error) };

  const invoiceId = created?.id;

  if (invoiceId && cadence.rows.length) {
    const { error: rowsError } = await createAdminClient()
      .from('invoice_dunning_steps')
      .insert(cadence.rows.map((row) => ({ ...row, invoice_id: invoiceId })));

    // The invoice exists and the mode says custom, so a failure here would
    // leave it following the account cadence while claiming its own. Saying so
    // is better than a silent difference nobody can see.
    if (rowsError) return { error: saveFailed(t, 'invoices:scenario', rowsError) };
  }

  // The customer is told the invoice exists, now, while it is being raised —
  // not on tomorrow's sweep, by which point "has been issued" is stale. It
  // never fails the creation: the invoice is saved either way, and the sweep
  // picks up a notice that did not go out.
  if (created?.id) await noticeOnIssue(org.id, created.id);

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  return { success: t.forms.success.invoiceCreated };
}


/**
 * How many messages one press may actually send.
 *
 * Counted in sends, not in selected rows. The old limit counted rows, which
 * made it meaningless: the list renders a checkbox twice for every invoice —
 * once in the card layout and once in the table, both in the document with one
 * hidden by CSS — so selecting everything submitted every id twice, "50" was
 * twenty-five invoices, and a hundred and forty rows reported themselves as two
 * hundred and eighty-two.
 *
 * Collapsed to one invoice per customer, a selection of any size becomes a work
 * list the size of the customer list, which one press can finish.
 */
const MAX_SENDS = 200;

/**
 * How many rows the other bulk operations may touch in one press.
 *
 * Settling invoices and running a scenario are one database write each rather
 * than a call to a mail provider, so rows are the right unit for them.
 */
const BULK_LIMIT = 50;

/**
 * Sends in flight at once, and the floor on how long a round may take.
 *
 * The mail provider allows ten requests a second. Six in flight with nothing
 * pacing them is well past that — a run of eighty-seven reminders lost
 * thirty-six to a rate limit that way. Four per round, each round no shorter
 * than half a second, keeps the whole batch under eight a second with room to
 * spare, and the retry inside the sender covers whatever still slips through.
 */
const CONCURRENCY = 4;
const MIN_ROUND_MS = 500;

/**
 * Sends the same reminder to every selected invoice.
 *
 * The shape of the work is decided before anything is sent, and that is what
 * makes one press enough. At most one message reaches a customer per day, so a
 * selection of a hundred and forty invoices belonging to ninety customers is
 * ninety sends however it is sliced — the rest were always going to be refused
 * by the daily rule. Working that out first turns "press it five more times"
 * into a single press that finishes.
 */
export async function sendBulkReminder(formData: FormData): Promise<void> {
  // Deduplicated: the same invoice arrives twice from the two layouts.
  const ids = [...new Set(formData.getAll('ids').map(String).filter(Boolean))];
  // Form data is caller-suppliable; only a same-site path is ever followed.
  const back = safeNextPath(formData.get('back'), '/invoices');
  const slot = parseReminderSlot(String(formData.get('choice') ?? 'manual'));

  const to = (params: Record<string, string | number>) => {
    const query = new URLSearchParams(back.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${back.split('?')[0]}?${query}`;
  };

  // A bulk press that selects nothing looks identical to one that fails: both
  // redirect instantly and change nothing. Say which it was.
  console.info('[bulk] pressed', { ids: ids.length, back });
  if (!ids.length) redirect(to({ bulk: 'none' }));
  if (!slot) redirect(to({ bulk: 'unknown_template' }));

  const org = await writableOrganization();
  if (!org) redirect(to({ bulk: 'forbidden' }));

  const only = channelChoice(formData.get('only'));
  const language = parseLanguageChoice(formData.get('lang'));

  const admin = createAdminClient();

  const [{ data: rows }, { data: alreadySent }, { data: tenant }] = await Promise.all([
    admin
      .from('invoices')
      .select('id, debtor_id')
      .eq('user_id', org.id)
      .eq('status', 'pending')
      .in('id', ids.slice(0, 1000)),
    admin
      .from('communications_log')
      .select('debtor_id, sent_at')
      .eq('user_id', org.id)
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()),
    admin.from('users').select('timezone').eq('id', org.id).maybeSingle(),
  ]);

  const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;
  const today = zonedDate(timezone);

  const contacted = new Set(
    (alreadySent ?? [])
      .filter((row) => row.debtor_id && contactedOn([row], timezone, today))
      .map((row) => row.debtor_id),
  );

  // One invoice per customer, and none for a customer who has already heard
  // from us today.
  const plan = planBulkSend(rows ?? [], contacted, MAX_SENDS);
  const batch = plan.work;
  let limited = plan.limited;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Concurrent, which the sequential version could not be: it sent one invoice
  // at a time precisely because two of the same customer would race each other
  // into the unique index behind the daily guarantee. There is now at most one
  // invoice per customer in the batch, so nothing in it can collide.
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const startedAt = Date.now();
    const results = await Promise.all(
      batch.slice(i, i + CONCURRENCY).map((id) =>
        sendManualReminder({
          userId: org.id,
          invoiceId: id,
          step: slot.step,
          variant: slot.variant,
          only,
          language,
        }),
      ),
    );

    for (const result of results) {
      if (result.error) {
        if (result.code === 'daily_limit') limited += 1;
        else failed += 1;
        continue;
      }

      if (result.emailsSent + result.smsSent > 0) sent += 1;
      else skipped += 1;
    }

    // Pace the next round rather than racing into the provider's limit. Only
    // waits for the remainder, so a slow round costs nothing extra.
    const elapsed = Date.now() - startedAt;
    if (i + CONCURRENCY < batch.length && elapsed < MIN_ROUND_MS) {
      await new Promise((done) => setTimeout(done, MIN_ROUND_MS - elapsed));
    }
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
      // What is genuinely still owed a message, which is customers rather than
      // rows. Zero unless the selection was larger than one press can carry.
      left: plan.left,
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
  // Deduplicated: the same invoice arrives twice, once from each layout.
  const ids = [...new Set(formData.getAll('ids').map(String).filter(Boolean))];
  // Same rule as sendBulkReminder: never redirect off-site on form input.
  const back = safeNextPath(formData.get('back'), '/invoices');

  const to = (params: Record<string, string | number>) => {
    const query = new URLSearchParams(back.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${back.split('?')[0]}?${query}`;
  };

  if (!ids.length) redirect(to({ bulk: 'none' }));

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) redirect('/login');

  const batch = ids.slice(0, BULK_LIMIT);
  const scenario = await loadScenario(org.id);
  const today = athensDate();

  // Retried without the per-invoice switch when that column has not been pushed
  // yet. Without the fallback the whole select fails, every invoice looks like it
  // has no due date, and the operator is told the batch failed — see
  // missingColumn() for why a deploy can legitimately run ahead of a migration.
  const selected = await supabase
    .from('invoices')
    .select('id, due_date, automation_enabled')
    .eq('user_id', org.id)
    .in('id', batch);

  let rows = selected.data;

  if (missingColumn(selected.error)) {
    // Both selects are written out in full rather than built from a variable:
    // postgrest infers the row type from the literal, and a computed string
    // collapses it to an error type that no longer has the columns on it.
    const fallback = await supabase
      .from('invoices')
      .select('id, due_date')
      .eq('user_id', org.id)
      .in('id', batch);

    // Absent means the switch does not exist yet, and an invoice that cannot be
    // paused is one that is chased — the same reading automationPaused() takes.
    rows = fallback.data?.map((row) => ({ ...row, automation_enabled: true })) ?? null;
  }

  const language = parseLanguageChoice(formData.get('lang'));

  const dueDates = new Map((rows ?? []).map((row) => [row.id, row.due_date]));
  const paused = new Set((rows ?? []).filter(automationPaused).map((r) => r.id));

  let sent = 0;
  let limited = 0;
  let skipped = 0;
  let failed = 0;
  let notDue = 0;
  let pausedCount = 0;

  for (const id of batch) {
    const dueDate = dueDates.get(id);
    if (!dueDate) {
      failed += 1;
      continue;
    }

    // This button runs the scenario, and a paused invoice is one the scenario
    // has been told to leave alone. Honouring the selection instead would make
    // the toggle meaningless the moment somebody selects every row.
    if (paused.has(id)) {
      pausedCount += 1;
      continue;
    }

    const rung = stepForInvoice(dueDate, today, scenario);
    if (!rung) {
      notDue += 1;
      continue;
    }

    const result = await sendManualReminder({
      userId: org.id,
      invoiceId: id,
      step: rung.step,
      language,
    });

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
      paused: pausedCount,
      left: Math.max(0, ids.length - batch.length),
    }),
  );
}
/**
 * Marks every selected invoice as settled.
 *
 * The gap this fills is not convenience. Invoices synced from myDATA and Elorus
 * arrive without a paid flag even when the money came in years ago, and the only
 * way to clear a book of them one at a time was the per-row button — so they got
 * deleted instead, which destroys the record rather than completing it.
 *
 * Only `pending` rows are touched, and the filter is repeated in the statement
 * as well as in the read: two operators pressing this at once must not settle
 * the same invoice twice, and the row that already moved simply does not match.
 *
 * `paid_amount_cents` is set to the invoice amount, because that is the claim
 * being made — somebody is asserting this was paid in full. A partial payment is
 * a different fact and does not belong behind a bulk button.
 */
export async function markBulkPaid(formData: FormData): Promise<void> {
  // Deduplicated, for the same reason: fifty ids were twenty-five invoices.
  const ids = [...new Set(formData.getAll('ids').map(String).filter(Boolean))];
  const back = safeNextPath(formData.get('back'), '/invoices');

  const to = (params: Record<string, string | number>) => {
    const query = new URLSearchParams(back.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${back.split('?')[0]}?${query}`;
  };

  if (!ids.length) redirect(to({ bulk: 'none' }));

  const org = await writableOrganization();
  if (!org) redirect(to({ bulk: 'forbidden' }));

  const admin = createAdminClient();

  const { data: changed, error } = await admin
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .eq('user_id', org.id)
    .eq('status', 'pending')
    .in('id', ids.slice(0, BULK_LIMIT))
    .select('id, amount_cents');

  if (error) {
    console.error('[bulk:paid]', error.message);
    redirect(to({ bulk: 'failed' }));
  }

  // The amount is per row, so it cannot ride along with the update above.
  for (const invoice of changed ?? []) {
    await admin
      .from('invoices')
      .update({ paid_amount_cents: invoice.amount_cents })
      .eq('id', invoice.id);
  }

  revalidatePath('/invoices');
  revalidatePath('/debtors');
  revalidatePath('/dashboard');

  redirect(to({ paid: changed?.length ?? 0 }));
}
