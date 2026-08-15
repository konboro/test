import { NextResponse, type NextRequest } from 'next/server';

import { appUrl } from '@/lib/env';
import { payCredentialColumn, payPath } from '@/lib/pay-code';
import { paymentsFor } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Stripe returns the debtor after a successful Checkout.
 *
 * The webhook remains the authoritative settlement path, but it cannot be the
 * only one: a tenant paying through their own key has no webhook pointed at us,
 * and configuring one per tenant is a lot to ask before the first payment has
 * even been tested. Confirming on return closes that gap.
 *
 * It is safe because nothing is trusted from the URL. The session id is looked
 * up against Stripe, which is the source of truth for whether money moved, and
 * the session's own metadata must name the invoice this payment link belongs
 * to — so a session id copied from somewhere else settles nothing.
 *
 * Idempotent by the same guard the webhook uses: the update is conditional on
 * the invoice still being `pending`, so arriving twice, or after the webhook has
 * already run, changes nothing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get('token') ?? '';
  const sessionId = params.get('session_id') ?? '';

  // Back to the URL shape the debtor arrived on: short link or legacy token.
  const back = (suffix: string) =>
    NextResponse.redirect(`${appUrl()}${payPath(token)}${suffix}`);

  if (!token) return NextResponse.redirect(appUrl());
  if (!sessionId) return back('');

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, status, amount_cents')
    .eq(payCredentialColumn(token), token)
    .maybeSingle();

  // Show the page regardless: the debtor has paid and should not be met with an
  // error because our bookkeeping had a bad moment.
  if (!invoice) return back('?paid=1');

  const { data: creditor } = await admin
    .from('users')
    .select('stripe_account_id, stripe_charges_enabled, stripe_secret_key_enc')
    .eq('id', invoice.user_id)
    .maybeSingle();

  const payments = creditor ? paymentsFor(creditor) : ({ kind: 'none' } as const);
  if (payments.kind === 'none') return back('?paid=1');

  try {
    const session = payments.options
      ? await payments.client.checkout.sessions.retrieve(sessionId, payments.options)
      : await payments.client.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') return back('?paid=1');

    // Metadata is written by our own pay route. A session belonging to a
    // different invoice must not settle this one.
    if (session.metadata?.invoice_id !== invoice.id) {
      console.error('[stripe:confirm] session does not belong to this invoice', {
        invoiceId: invoice.id,
        sessionId,
      });
      return back('?paid=1');
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_amount_cents: session.amount_total ?? invoice.amount_cents,
        stripe_payment_intent_id: paymentIntentId,
        stripe_checkout_session_id: session.id,
      })
      .eq('id', invoice.id)
      .eq('status', 'pending');
  } catch (cause) {
    // A failure here costs nothing: the webhook still settles it if configured,
    // and the debtor still sees their confirmation.
    console.error('[stripe:confirm] could not verify session', String(cause));
  }

  return back('?paid=1');
}
