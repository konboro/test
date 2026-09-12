import { invoiceLabel } from '@/lib/dunning/dispatch';
import { sendEmail } from '@/lib/email/send';
import { DICTIONARIES, isLocale } from '@/lib/i18n/dictionaries';
import { formatDate, formatMoney } from '@/lib/money';
import { emailAvailable } from '@/lib/providers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Who hears that money arrived.
 *
 * The account holder always, and the reply-to address as well when it differs.
 *
 * Reply-to used to be the only recipient, on the reasoning that replies about
 * money should reach whoever handles it. That confuses two different addresses:
 * reply-to is where a *debtor* answering a reminder lands, which is routinely a
 * shared inbox nobody watches for their own notifications. Setting it silently
 * redirected every payment notice away from the person who signed up — they were
 * being sent, to somewhere he never looks.
 *
 * Deduplicated case-insensitively, because the two fields holding the same
 * address in different case is a configuration detail, not a request for two
 * copies.
 */
export function notificationRecipients(tenant: {
  email?: string | null;
  reply_to_email?: string | null;
}): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();

  for (const address of [tenant.email, tenant.reply_to_email]) {
    const trimmed = address?.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    chosen.push(trimmed);
  }

  return chosen;
}

/**
 * Tells the creditor that one of their invoices has been paid.
 *
 * Deliberately not written to `communications_log`. That table is the record of
 * what was sent *to debtors on the tenant's behalf* — it is what the compliance
 * story rests on and what the history screen shows. A note to the tenant about
 * their own money is a different kind of message, and mixing the two would make
 * the audit trail answer a question nobody asked of it.
 *
 * Never throws. It runs immediately after settlement, and a mail provider having
 * a bad minute must not turn a successful payment into a failed request.
 */
export async function notifyPaymentReceived(invoiceId: string): Promise<void> {
  if (!emailAvailable()) return;

  try {
    const supabase = createAdminClient();

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!invoice) return;

    const [{ data: tenant }, { data: debtor }] = await Promise.all([
      supabase.from('users').select('*').eq('id', invoice.user_id).maybeSingle(),
      supabase.from('debtors').select('name').eq('id', invoice.debtor_id).maybeSingle(),
    ]);

    if (!tenant) return;

    // Switched off in settings. Checked here rather than at each of the four
    // call sites — Stripe return, Stripe webhook, Viva return and the bank
    // sweep all end here, and a preference honoured in three of them is worse
    // than none at all.
    if (tenant.notify_on_payment === false) return;

    // Replies still go to the money desk; the notice itself goes to everyone
    // who should know, the account holder included.
    const recipients = notificationRecipients(tenant);
    if (recipients.length === 0) return;

    const t = DICTIONARIES[isLocale(tenant.locale) ? tenant.locale : 'el'];
    const amount = formatMoney(invoice.paid_amount_cents ?? invoice.amount_cents, invoice.currency);
    const label = invoiceLabel(invoice);
    const customer = debtor?.name ?? '—';

    const lines = [
      t.paymentReceived.line(customer, amount, label),
      '',
      `${t.invoices.colAmount}: ${amount}`,
      `${t.invoices.colCustomer}: ${customer}`,
      `${t.invoices.colInvoice}: ${label}`,
      `${t.invoices.colDue}: ${formatDate(invoice.due_date)}`,
    ];

    const text = lines.join('\n');

    for (const to of recipients) {
      await sendEmail({
        to,
        subject: t.paymentReceived.subject(amount, label),
        text,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;">${lines
          .map((line) => (line ? `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>` : ''))
          .join('')}</div>`,
      });
    }

    // Nothing records this: it is deliberately kept out of communications_log,
    // which is the record of what went to debtors. One line in the runtime log
    // is the only way to answer "was I told?" after the fact.
    console.info('[payments:notify] sent', { invoiceId, recipients: recipients.length });
  } catch (cause) {
    // Settlement already happened and is recorded; this is a courtesy on top.
    console.error('[payments:notify] could not notify the creditor', String(cause));
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
