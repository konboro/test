import { escapeHtml } from '@/lib/html';
import { sendEmail } from '@/lib/email/send';
import { appUrl } from '@/lib/env';
import { formatDate, formatMoney } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ReportBankHint, ReportDetails, ReportKind } from '@/types/database';

import { bankHintsFor } from './bank-hint';
import type { ChatMessage } from './validate';

/**
 * Filing one report: the row, the bank cross-check, the email.
 *
 * Runs under the service role — the visitor is anonymous and the table takes
 * no browser writes — so everything identifying (user_id, debtor_id) comes
 * from the invoice row the payment credential resolved to, never from the
 * request.
 */

export interface ReportTarget {
  invoiceId: string;
  userId: string;
  debtorId: string;
  amountCents: number;
  invoiceLabel: string;
  debtorName: string;
}

export type SubmitOutcome = 'filed' | 'already_open' | 'failed';

export async function fileReport(params: {
  target: ReportTarget;
  kind: ReportKind;
  details: ReportDetails;
  transcript: ChatMessage[] | null;
}): Promise<SubmitOutcome> {
  const { target, kind, details, transcript } = params;
  const admin = createAdminClient();

  // Corroborate a payment claim against the feed while the claim is fresh —
  // the reviewer's first move is this exact lookup, so it ships on the report.
  let bankMatch: ReportBankHint[] | null = null;
  if (kind === 'paid_claim') {
    const { data: credits } = await admin
      .from('bank_transactions')
      .select('booked_on, amount_cents, counterparty_name, state')
      .eq('user_id', target.userId)
      .in('state', ['unmatched', 'review'])
      .order('booked_on', { ascending: false })
      .limit(200);

    const hints = bankHintsFor(details, target.amountCents, credits ?? []);
    bankMatch = hints.length ? hints : null;
  }

  const { error } = await admin.from('invoice_reports').insert({
    user_id: target.userId,
    invoice_id: target.invoiceId,
    debtor_id: target.debtorId,
    kind,
    details,
    transcript,
    bank_match: bankMatch,
  });

  if (error) {
    // The partial unique index: an open report of this kind already exists.
    // For the visitor that is success — their statement is on file.
    if (error.code === '23505') return 'already_open';

    console.error('[reports] insert failed', error.message);
    return 'failed';
  }

  await notifyCreditor(target, kind, details, bankMatch);
  return 'filed';
}

/**
 * The email is best-effort: the report is on the invoices screen either way,
 * and a notification failure must not surface as "we could not record this"
 * to a debtor whose statement was in fact recorded.
 */
async function notifyCreditor(
  target: ReportTarget,
  kind: ReportKind,
  details: ReportDetails,
  bankMatch: ReportBankHint[] | null,
): Promise<void> {
  const admin = createAdminClient();
  const { data: creditor } = await admin
    .from('users')
    .select('email, company_name')
    .eq('id', target.userId)
    .maybeSingle();

  if (!creditor?.email) return;

  const subject =
    kind === 'paid_claim'
      ? `Δήλωση πληρωμής: ${target.debtorName} — ${target.invoiceLabel}`
      : `Αμφισβήτηση παραστατικού: ${target.debtorName} — ${target.invoiceLabel}`;

  const lines = [
    kind === 'paid_claim'
      ? `Ο πελάτης ${target.debtorName} δηλώνει ότι έχει εξοφλήσει το παραστατικό ${target.invoiceLabel}.`
      : `Ο πελάτης ${target.debtorName} δηλώνει πρόβλημα με το παραστατικό ${target.invoiceLabel}.`,
    '',
    details.summary ? `Δήλωση: ${details.summary}` : null,
    details.claimed_paid_on ? `Ημερομηνία πληρωμής: ${formatDate(details.claimed_paid_on)}` : null,
    details.claimed_amount_cents
      ? `Ποσό: ${formatMoney(details.claimed_amount_cents)}`
      : null,
    details.reference ? `Στοιχείο πληρωμής: ${details.reference}` : null,
    details.dispute_reason ? `Αιτία: ${details.dispute_reason}` : null,
    details.contact ? `Επικοινωνία: ${details.contact}` : null,
    '',
    bankMatch?.length
      ? `Πιθανή αντιστοίχιση στον τραπεζικό σας λογαριασμό: ${bankMatch
          .map((hint) => `${formatMoney(hint.amount_cents)} στις ${formatDate(hint.booked_on)}`)
          .join(' · ')}`
      : null,
    'Οι υπενθυμίσεις για αυτό το παραστατικό έχουν ανασταλεί μέχρι να το εξετάσετε.',
    '',
    `Εξέταση: ${appUrl()}/invoices`,
  ].filter((line): line is string => line !== null);

  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a202c">${lines
    .map((line) =>
      line === ''
        ? '<br>'
        : line.startsWith('Εξέταση:')
          ? `<p><a href="${appUrl()}/invoices" style="display:inline-block;background:#4c6ef5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Εξέταση στο lefta.app</a></p>`
          : `<p style="margin:2px 0">${escapeHtml(line)}</p>`,
    )
    .join('')}</div>`;

  const sent = await sendEmail({ to: creditor.email, subject, text, html });
  if (!sent.ok) console.error('[reports] notification email failed', sent.error);
}
