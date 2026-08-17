import { NextResponse, type NextRequest } from 'next/server';

import { appUrl } from '@/lib/env';
import { payPath } from '@/lib/pay-code';
import { notifyPaymentReceived } from '@/lib/payments/notify';
import { PAYMENT_COLUMNS, vivaCredentialsFor } from '@/lib/payments/provider';
import { createAdminClient } from '@/lib/supabase/admin';
import { belongsToOrder, isSettled, retrieveTransaction } from '@/lib/viva/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Viva returns the debtor, whether they paid or not.
 *
 * One endpoint for both outcomes on purpose. A Viva payment source carries a
 * single pair of static redirect URLs configured in the merchant's own banking
 * app — they cannot be set per order, and they cannot carry our payment token.
 * So the URL tells us nothing we are willing to act on, and everything is
 * rebuilt from the order code Viva appends and the transaction read back from
 * their API.
 *
 * Nothing in the query string is trusted. `t` is used only as a lookup key; the
 * decision to settle comes from Viva's own record of the transaction, and that
 * record must belong to the order we created for this invoice.
 *
 * Idempotent by the same guard the Stripe paths use: the update is conditional
 * on the invoice still being `pending`, so a refresh or a double redirect
 * changes nothing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const orderCode = params.get('s') ?? '';
  const transactionId = params.get('t') ?? '';

  const admin = createAdminClient();

  // Without an order code there is nothing to look up. Home is the only honest
  // destination — we cannot know which invoice this was.
  if (!orderCode) return NextResponse.redirect(appUrl());

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, status, short_code, pay_token')
    .eq('viva_order_code', orderCode)
    .maybeSingle();

  if (!invoice) return NextResponse.redirect(appUrl());

  const back = (suffix: string) =>
    NextResponse.redirect(`${appUrl()}${payPath(invoice.short_code ?? invoice.pay_token)}${suffix}`);

  // Cancelled or abandoned: Viva sends the debtor back here with no transaction.
  // The invoice is untouched and the page will simply offer the button again.
  if (!transactionId) return back('');

  const { data: creditor } = await admin
    .from('users')
    .select(PAYMENT_COLUMNS)
    .eq('id', invoice.user_id)
    .maybeSingle();

  const credentials = creditor ? vivaCredentialsFor(creditor) : null;
  if (!credentials) return back('');

  let transaction;
  try {
    transaction = await retrieveTransaction(credentials, transactionId);
  } catch (cause) {
    // We do not know whether money moved, so we must not claim it did. The page
    // shows the button again and every later visit re-runs this check, so a
    // debtor who did pay is never stuck — but nobody is told a payment
    // succeeded on the strength of a failed lookup.
    console.error('[viva:return] could not read the transaction back', cause);
    return back('');
  }

  // A transaction id from somewhere else must not settle this invoice, even if
  // it is genuinely paid. The order code is ours and ties the two together.
  if (!belongsToOrder(transaction, orderCode)) {
    console.error('[viva:return] transaction does not belong to this order', {
      invoiceId: invoice.id,
      orderCode,
    });
    return back('');
  }

  if (!isSettled(transaction)) return back('');

  try {
    const { data: settled, error } = await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        viva_transaction_id: transaction.transactionId,
      })
      .eq('id', invoice.id)
      .eq('status', 'pending')
      .select('id');

    if (error) throw new Error(error.message);

    if (settled?.length) {
      // Marking it paid removes it from the dunning engine's candidate set on
      // the next sweep — this is the AUTO-STOP.
      console.info('[viva:return] invoice paid', invoice.id);
      await notifyPaymentReceived(invoice.id);
    }
  } catch (cause) {
    // Viva has confirmed the money moved, so the debtor is done regardless of
    // what our own bookkeeping just did. A failure here is ours to fix — and the
    // next visit to the link re-runs the whole check — but it must not be shown
    // to them as though their payment failed.
    console.error('[viva:return] settling a confirmed payment failed', cause);
  }

  return back('?paid=1');
}
