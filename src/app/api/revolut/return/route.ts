import { NextResponse, type NextRequest } from 'next/server';

import { appUrl } from '@/lib/env';
import { PAY_CODE_LENGTH, payCredentialColumn, payPath } from '@/lib/pay-code';
import { notifyPaymentReceived } from '@/lib/payments/notify';
import { PAYMENT_COLUMNS, revolutCredentialsFor } from '@/lib/payments/provider';
import { belongsToInvoice, isPaid, retrieveOrder } from '@/lib/revolut/client';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Revolut returns the debtor after the hosted checkout.
 *
 * Unlike the Viva return, this URL is ours per order, so it carries the payment
 * credential the debtor arrived on and the round trip lands back on their own
 * page. That is convenience only — nothing in the query string is trusted.
 *
 * The decision to settle comes from Revolut's own record of the order: it must
 * be `completed`, and its reference must name this invoice. An order id from
 * somewhere else settles nothing even if it is genuinely paid.
 *
 * Idempotent by the same guard every other settlement path uses: the update is
 * conditional on the invoice still being `pending`, so a refresh, a double
 * redirect or a later visit changes nothing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get('token') ?? '';
  const orderId = params.get('_rp_oid') ?? params.get('order_id') ?? '';

  const admin = createAdminClient();

  // The credential is the only thing that says where to send them back to.
  const validToken =
    token.length >= PAY_CODE_LENGTH && token.length <= 128 && /^[A-Za-z0-9]+$/.test(token);
  if (!validToken) return NextResponse.redirect(appUrl());

  const back = (suffix: string) => NextResponse.redirect(`${appUrl()}${payPath(token)}${suffix}`);

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, status')
    .eq(payCredentialColumn(token), token)
    .maybeSingle();

  if (!invoice) return NextResponse.redirect(appUrl());

  // Revolut appends its own order parameter on the redirect. If it is absent —
  // a cancelled checkout, or a parameter name that changed — fall back to the
  // most recent order minted for this invoice, which is the one the debtor was
  // just sent to.
  const { data: recorded } = await admin
    .from('revolut_orders')
    .select('order_id, amount_cents')
    .eq('invoice_id', invoice.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const latest = recorded?.[0] ?? null;
  const resolvedOrderId = orderId || latest?.order_id || '';
  if (!resolvedOrderId) return back('');

  // The amount is taken from what we recorded at minting time, never from the
  // invoice as it stands now: an Elorus sync or a manual edit can legitimately
  // change the row while a checkout sits open, and settling with the corrected
  // figure would book money that never arrived.
  const { data: order } = await admin
    .from('revolut_orders')
    .select('amount_cents')
    .eq('order_id', resolvedOrderId)
    .eq('invoice_id', invoice.id)
    .maybeSingle();

  if (!order) {
    console.error('[revolut:return] order does not belong to this invoice', {
      invoiceId: invoice.id,
      resolvedOrderId,
    });
    return back('');
  }

  const { data: creditor } = await admin
    .from('users')
    .select(PAYMENT_COLUMNS)
    .eq('id', invoice.user_id)
    .maybeSingle();

  const credentials = creditor ? revolutCredentialsFor(creditor) : null;
  if (!credentials) return back('');

  let remote;
  try {
    remote = await retrieveOrder(credentials, resolvedOrderId);
  } catch (cause) {
    // We do not know whether money moved, so we must not claim it did. The page
    // offers the button again and a later visit re-runs this check.
    console.error('[revolut:return] could not read the order back', String(cause));
    return back('');
  }

  if (!belongsToInvoice(remote, invoice.id)) {
    console.error('[revolut:return] order reference does not name this invoice', {
      invoiceId: invoice.id,
      resolvedOrderId,
    });
    return back('');
  }

  // Not paid yet: cancelled, declined, or still pending. Nothing to record —
  // the page will simply offer the button again.
  if (!isPaid(remote)) return back('');

  try {
    const { data: settled, error } = await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_amount_cents: order.amount_cents,
        revolut_order_id: remote.id,
      })
      .eq('id', invoice.id)
      .eq('status', 'pending')
      .select('id');

    if (error) throw new Error(error.message);

    if (settled?.length) {
      // Marking it paid removes it from the dunning engine's candidate set on
      // the next sweep — this is the AUTO-STOP.
      console.info('[revolut:return] invoice paid', invoice.id);
      await notifyPaymentReceived(invoice.id);
    }
  } catch (cause) {
    // Revolut has confirmed the money moved, so the debtor is done regardless
    // of what our bookkeeping just did. A failure here is ours to fix — and the
    // next visit re-runs the whole check — but it must not be shown to them as
    // though their payment failed.
    console.error('[revolut:return] settling a confirmed payment failed', String(cause));
  }

  return back('?paid=1');
}
