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
import { normaliseCurrency } from '@/lib/currency';
import { athensDate, toCents } from '@/lib/money';
import { safeNextPath } from '@/lib/redirects';
import { activeOrganization, writableOrganization } from '@/lib/orgs/active';
import { reconcileCheckouts } from '@/lib/payments/reconcile';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { saveFailed } from '@/lib/errors';
import { formError, getDictionary } from '@/lib/i18n';
import { redirect } from 'next/navigation';
import { automationPaused, loadScenario, missingColumn, stepForInvoice } from '@/lib/dunning/engine';
import { noticeOnIssue } from '@/lib/dunning/issue-notice';
import { invoiceScenarioProblem, parseInvoiceScenario } from '@/lib/dunning/invoice-scenario';
import { parseInvoiceMessages } from '@/lib/dunning/invoice-messages';
import { effectiveNoticeTexts } from '@/lib/dunning/template-store';
import type { InvoiceScenarioMode } from '@/types/database';

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
 *
 * Both columns are written, because the pause is stored twice: `scenario_mode`
 * of 'off' says the same thing as `automation_enabled` of false, and the cadence
 * editor has always written the pair together. This wrote only the flag, so a
 * box unticked here and then ticked again left the mode saying 'off' — and the
 * invoice's own page, which reads the mode, reported that nothing was scheduled
 * while the sweep, which read the flag, went on sending.
 *
 * Switching back on restores 'custom' rather than 'default' when the invoice has
 * a ladder of its own. Those rows outlive the pause — only the cadence editor
 * deletes them — so resuming with 'default' would quietly abandon a schedule the
 * operator wrote by hand and never asked to lose.
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

  // `enabled` is what the row was showing, so the press is asking for its
  // opposite.
  const turningOn = !enabled;

  let mode: InvoiceScenarioMode = 'off';

  if (turningOn) {
    const { data: overrides } = await supabase
      .from('invoice_dunning_steps')
      .select('invoice_id')
      .eq('invoice_id', id)
      .limit(1);

    mode = overrides?.length ? 'custom' : 'default';
  }

  const { error } = await supabase
    .from('invoices')
    .update({ automation_enabled: turningOn, scenario_mode: mode })
    .eq('id', id);

  // A column missing from the update grant is denied rather than ignored, and
  // the whole statement fails with it — so a failure here means the switch did
  // not move, and saying nothing would leave the operator looking at a box that
  // springs back on the next render with no explanation.
  if (error) console.error('[invoices] automation toggle refused', error.message);

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  revalidatePath(`/invoices/${id}`);
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
  revalidatePath('/statistics');
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
  revalidatePath('/statistics');

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
  revalidatePath('/statistics');

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
  // Unrecognised falls back rather than being refused: the operator picks from a
  // list and cannot type here, so anything odd arriving is a stale form or a
  // crafted post — neither worth an error message about.
  currency: z.unknown().transform(normaliseCurrency),
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
    currency: formData.get('currency'),
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

  // The wording the operator may have tweaked beside the cadence. Compared
  // against the account's effective text: untouched means no row, and the
  // notice keeps following the account template.
  const messages = parseInvoiceMessages(
    formData,
    await effectiveNoticeTexts(org.id),
  );

  const base = {
      user_id: org.id,
      debtor_id: parsed.data.debtor_id,
      invoice_number: parsed.data.invoice_number,
      series: parsed.data.series,
      amount_cents: toCents(parsed.data.amount),
      currency: parsed.data.currency,
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

  // Before the notice goes out, or it would render the account wording the
  // operator just replaced. Tolerant of the table missing (deploys and
  // migrations do not land together): the invoice stands, the notice falls
  // back to the account text, and the log says why.
  if (invoiceId && messages.length) {
    const { error: messageError } = await createAdminClient()
      .from('invoice_messages')
      .insert(messages.map((row) => ({ ...row, invoice_id: invoiceId, user_id: org.id })));

    if (messageError) {
      console.warn('[invoices] invoice_messages write failed', messageError.message);
    }
  }

  // The customer is told the invoice exists, now, while it is being raised —
  // not on tomorrow's sweep, by which point "has been issued" is stale. It
  // never fails the creation: the invoice is saved either way, and the sweep
  // picks up a notice that did not go out.
  if (created?.id) await noticeOnIssue(org.id, created.id);

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  return { success: t.forms.success.invoiceCreated };
}

/**
 * How long one press may spend sending before it stops and reports the rest.
 *
 * The cap above is a thousand; the platform's ceiling on a single request is
 * not. At four sends a round and half a second a round, a thousand reminders
 * need something over two minutes, and the scenario path sends one at a time,
 * so it needs considerably more. Without a budget the run is killed mid-flight:
 * some customers messaged, no redirect, no summary, and an operator with no way
 * to know where it stopped.
 *
 * So the work stops on its own with time to spare and reports what is left,
 * which is the counter the page already renders. Pressing again continues —
 * nothing is sent twice, because the day's contact is claimed before delivery
 * and the next press sees it.
 */
const SEND_BUDGET_MS = 45_000;

/**
 * How many selected rows one press will touch.
 *
 * Not a decision about how much to send — that ceiling is gone. This one exists
 * because the ids arrive in a form post, and an unbounded `in` clause is a URL
 * long enough to be refused before it is read.
 */
const MAX_ROWS_READ = 5000;

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

  const { data: rows } = await admin
    .from('invoices')
    .select('id, debtor_id, automation_enabled')
    .eq('user_id', org.id)
    .eq('status', 'pending')
    .in('id', ids.slice(0, MAX_ROWS_READ));

  // An invoice whose automation is switched off stays out of a bulk press.
  //
  // The single-row button deliberately still works on a paused invoice —
  // pausing says "stop chasing this on your own", not "refuse me when I ask".
  // Behind select-all that reading inverts: one press would contact every
  // customer the operator had explicitly excluded, which is the opposite of
  // what switching them off meant.
  const eligible = (rows ?? []).filter((row) => row.automation_enabled !== false);
  const paused = (rows ?? []).length - eligible.length;

  // Anyone who has already paid drops out before a word is written.
  //
  // A card payment is only recorded when the debtor's browser returns from the
  // checkout, so an invoice can be settled in fact and open here. The nightly
  // cron asks the providers, but a bulk press does not wait for the cron — and
  // emailing somebody a reminder for money they have already handed over is the
  // worst thing this screen can do. Only rows that ever started a checkout cost
  // a call, which is a handful of the book.
  let closed = new Set<string>();

  try {
    const reconciled = await reconcileCheckouts({ invoiceIds: eligible.map((row) => row.id) });
    closed = new Set(reconciled.settledIds);
    if (reconciled.settled) console.info('[bulk] settled before sending', reconciled);
  } catch (cause) {
    // Never fatal: the operator asked to send, and a provider having a bad
    // moment must not swallow the press.
    console.error('[bulk] reconcile failed', String(cause));
  }

  const open = eligible.filter((row) => !closed.has(row.id));
  const settledJustNow = closed.size;

  // Every selected invoice, in full. Two rules stood here and both are gone: a
  // cap on how many one press could carry, and a collapse to one message per
  // customer per day. What is selected is what is sent.
  const batch = open.map((row) => row.id);

  const startedRun = Date.now();
  let reached = batch.length;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Concurrent. The sequential version existed because two invoices of the same
  // customer would race each other into the unique index behind the daily
  // guarantee; that index is gone, so there is nothing left to collide over.
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    // Checked between rounds rather than inside one: a round already in flight
    // is finishing regardless, and abandoning its results would lose the record
    // of messages that did go out.
    if (Date.now() - startedRun > SEND_BUDGET_MS) {
      reached = i;
      break;
    }

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
        failed += 1;
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
      skipped,
      failed,
      paused,
      settled: settledJustNow,
      // What the clock stopped short of. Zero unless the run ran out of budget
      // mid-way; pressing again continues from there.
      left: batch.length - reached,
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
 * cancel the scheduled one. The sweep will still send that step on its own day.
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

  const batch = ids.slice(0, MAX_ROWS_READ);
  const scenario = await loadScenario(org.id);
  const today = athensDate();

  // Retried without the per-invoice switch when that column has not been pushed
  // yet. Without the fallback the whole select fails, every invoice looks like it
  // has no due date, and the operator is told the batch failed — see
  // missingColumn() for why a deploy can legitimately run ahead of a migration.
  const selected = await supabase
    .from('invoices')
    .select('id, due_date, automation_enabled, scenario_mode')
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
    rows =
      fallback.data?.map((row) => ({
        ...row,
        automation_enabled: true,
        scenario_mode: 'default' as const,
      })) ?? null;
  }

  const language = parseLanguageChoice(formData.get('lang'));

  const dueDates = new Map((rows ?? []).map((row) => [row.id, row.due_date]));
  const paused = new Set((rows ?? []).filter(automationPaused).map((r) => r.id));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let notDue = 0;
  let pausedCount = 0;
  let unreached = 0;

  const startedRun = Date.now();

  for (const [index, id] of batch.entries()) {
    // This path sends one at a time, so it runs out of clock sooner than the
    // reminder path does. Same contract: stop cleanly, say how many are left.
    if (Date.now() - startedRun > SEND_BUDGET_MS) {
      unreached = batch.length - index;
      break;
    }

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
      failed += 1;
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
      skipped,
      failed,
      notDue,
      paused: pausedCount,
      left: Math.max(0, ids.length - batch.length) + unreached,
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
    .in('id', ids.slice(0, MAX_ROWS_READ))
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
  revalidatePath('/statistics');

  redirect(to({ paid: changed?.length ?? 0 }));
}
