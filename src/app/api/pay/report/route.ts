import { NextResponse } from 'next/server';

import { dictionaryFor } from '@/lib/i18n';
import { resolveDebtorLocale, tenantLocale } from '@/lib/i18n/message-locale';
import { athensDate } from '@/lib/money';
import { payCredentialColumn } from '@/lib/pay-code';
import {
  chatConfigured,
  CHAT_TURNS_PER_DAY,
  chatTurn,
  closingFor,
  closingTurn,
  greetingFor,
  type ChatInvoice,
  type ChatLocales,
} from '@/lib/reports/chat';
import { fileReport, type ReportTarget } from '@/lib/reports/submit';
import {
  chatRequestSchema,
  detailsFrom,
  parseClaimedAmount,
  submitReportSchema,
} from '@/lib/reports/validate';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
// Two model calls on the filing turn; comfortably inside this, never inside 10s.
export const maxDuration = 60;

/**
 * The "I already paid / something is wrong" endpoint of the payment page.
 *
 * Public by the same argument as the payment itself: the caller is anonymous
 * and the credential in the link is everything they hold. It buys exactly two
 * abilities — paying this invoice, and attaching a report to it. Every
 * identifying value on the stored row comes from the invoice the credential
 * resolves to, never from the request body.
 *
 * Stateless: the browser sends the transcript each turn. The submission path
 * is shared by the chat (the model files through a strict tool) and the plain
 * form (used when no model is configured or a call fails) — one code path
 * writes reports, whichever door the facts came through.
 */
export async function POST(request: Request) {
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { token, kind, messages, form } = parsed.data;
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select(
      'id, user_id, debtor_id, amount_cents, currency, status, invoice_number, series, mark, issue_date, due_date',
    )
    .eq(payCredentialColumn(token), token)
    .maybeSingle();

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  // A settled invoice sends no reminders, so there is nothing to hold back —
  // and its payment page already says "paid", so the links are not rendered.
  if (invoice.status !== 'pending') {
    return NextResponse.json({ error: 'This invoice is not open.' }, { status: 409 });
  }

  const [{ data: debtor }, { data: creditor }, { data: existing }] = await Promise.all([
    admin.from('debtors').select('name, locale, phone').eq('id', invoice.debtor_id).maybeSingle(),
    admin
      .from('users')
      .select('company_name, email, locale')
      .eq('id', invoice.user_id)
      .maybeSingle(),
    admin
      .from('invoice_reports')
      .select('id')
      .eq('invoice_id', invoice.id)
      .eq('kind', kind)
      .eq('status', 'open')
      .maybeSingle(),
  ]);

  // The languages this exchange runs in: the visitor is answered in the one
  // their reminder was written in, the creditor reads the filed summary in
  // their own. Resolved here rather than in the chat module so the plain form,
  // the canned greeting and the model all agree on them.
  const writer = tenantLocale({ locale: creditor?.locale ?? null });
  const locales: ChatLocales = {
    reader: debtor ? resolveDebtorLocale(debtor, writer) : writer,
    writer,
  };
  const t = dictionaryFor(locales.reader).pay;

  // Their statement is already on file — that is success, said plainly, and it
  // also means the anonymous endpoint cannot be farmed for rows or model calls.
  if (existing) return NextResponse.json({ done: true, reply: t.alreadyFiled });

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || invoice.mark || '—';

  const target: ReportTarget = {
    invoiceId: invoice.id,
    userId: invoice.user_id,
    debtorId: invoice.debtor_id,
    amountCents: invoice.amount_cents,
    invoiceLabel: label,
    debtorName: debtor?.name ?? '—',
  };

  // The plain form: no model anywhere near it. What was typed is what is filed.
  if (form) {
    const outcome = await fileReport({
      target,
      kind,
      details: {
        summary: form.message,
        ...(form.paid_on ? { claimed_paid_on: form.paid_on } : {}),
        ...(parseClaimedAmount(form.amount)
          ? { claimed_amount_cents: parseClaimedAmount(form.amount)! }
          : {}),
        ...(form.reference ? { reference: form.reference } : {}),
        ...(form.contact ? { contact: form.contact } : {}),
        ...(kind === 'dispute' ? { dispute_reason: form.message } : {}),
      },
      transcript: null,
    });

    if (outcome === 'failed') {
      return NextResponse.json({ error: 'Could not record the report.' }, { status: 500 });
    }
    return NextResponse.json({ done: true, reply: closingFor(locales.reader) });
  }

  // Opening the panel: a canned greeting, instant and free of model calls.
  if (messages.length === 0) {
    return NextResponse.json(
      chatConfigured() ? { reply: greetingFor(kind, locales.reader) } : { mode: 'form' },
    );
  }

  if (!chatConfigured()) return NextResponse.json({ mode: 'form' });

  // One turn out of this invoice's allowance for the day, claimed before the
  // model is called rather than counted after it — an increment that happens
  // after the spend is a record, not a limit.
  //
  // Refused sends the visitor to the plain form: the same door they get when no
  // model is configured at all, filing through the same code path. Somebody
  // with a real statement to make is never turned away; only the model stops.
  //
  // A failure to check is not a failure to serve. The counter lives behind a
  // migration, and deploys and migrations do not land together — refusing every
  // conversation because the table is not there yet would be a worse outage
  // than the spending this prevents.
  const budget = await admin.rpc('claim_pay_chat_turn', {
    p_invoice: invoice.id,
    p_limit: CHAT_TURNS_PER_DAY,
    p_day: athensDate(),
  });

  if (budget.error) {
    console.error('[reports] chat budget unavailable', budget.error.message);
  } else if (budget.data === false) {
    console.warn('[reports] chat allowance spent for invoice', invoice.id);
    return NextResponse.json({ mode: 'form' });
  }

  const chatInvoice: ChatInvoice = {
    invoice_number: label,
    amount_cents: invoice.amount_cents,
    currency: invoice.currency,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    debtor_name: debtor?.name ?? '—',
    creditor_name: creditor?.company_name ?? creditor?.email ?? '—',
  };

  try {
    const turn = await chatTurn(kind, chatInvoice, messages, locales);

    if (!turn.submitted) return NextResponse.json({ reply: turn.reply });

    // Strict mode validated the shape at the API; this validates it again,
    // because the row being written is what a creditor decides money on.
    const submitted = submitReportSchema.safeParse(turn.submitted);
    if (!submitted.success) {
      console.error('[reports] tool payload rejected', submitted.error.issues[0]);
      return NextResponse.json({ mode: 'form' });
    }

    const outcome = await fileReport({
      target,
      kind,
      details: detailsFrom(kind, submitted.data),
      transcript: messages,
    });

    if (outcome === 'failed') return NextResponse.json({ mode: 'form' });
    if (outcome === 'already_open') {
      return NextResponse.json({ done: true, reply: t.alreadyFiled });
    }

    const closing = await closingTurn(kind, chatInvoice, messages, turn.assistantContent, locales);
    return NextResponse.json({ done: true, reply: closing });
  } catch (cause) {
    // Any model failure degrades to the form. The feature's availability must
    // not depend on the pleasant way in.
    console.error('[reports] chat failed', cause instanceof Error ? cause.message : String(cause));
    return NextResponse.json({ mode: 'form' });
  }
}
