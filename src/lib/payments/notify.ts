import { invoiceLabel } from '@/lib/dunning/dispatch';
import { sendEmail } from '@/lib/email/send';
import { DICTIONARIES, isLocale } from '@/lib/i18n/dictionaries';
import { formatDate, formatMoney } from '@/lib/money';
import { emailAvailable } from '@/lib/providers';
import { createAdminClient } from '@/lib/supabase/admin';

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

    // Replies about a payment should reach whoever handles the money, which is
    // the reply-to address when one is set.
    const to = tenant.reply_to_email || tenant.email;
    if (!to) return;

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

    await sendEmail({
      to,
      subject: t.paymentReceived.subject(amount, label),
      text,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;">${lines
        .map((line) => (line ? `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>` : ''))
        .join('')}</div>`,
    });
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
