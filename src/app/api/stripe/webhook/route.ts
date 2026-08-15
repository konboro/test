import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { requireEnv } from '@/lib/env';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook.
 *
 * This is the only place an invoice becomes `paid` and the only place SMS
 * credits are granted. Both paths are idempotent, because Stripe retries and
 * may deliver the same event more than once.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // The raw body is required — the signature is computed over the exact bytes.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      payload,
      signature,
      requireEnv('STRIPE_WEBHOOK_SECRET'),
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('[stripe:webhook] signature verification failed', message);
    return NextResponse.json({ error: `Webhook signature failed: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCompletedSession(event.data.object);
        break;

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        // Nothing to undo: the invoice was never marked paid.
        break;

      default:
        break;
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[stripe:webhook] handling ${event.type} failed`, message);
    // 500 makes Stripe retry, which is what we want for a transient DB error.
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCompletedSession(session: Stripe.Checkout.Session) {
  // `paid` is the only status that settles funds; `unpaid`/`no_payment_required`
  // must not grant anything.
  if (session.payment_status !== 'paid') return;

  const kind = session.metadata?.kind;
  const admin = createAdminClient();

  if (kind === 'invoice_payment') {
    const invoiceId = session.metadata?.invoice_id;
    if (!invoiceId) {
      console.error('[stripe:webhook] invoice_payment session without invoice_id', session.id);
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    // Idempotent + race-safe: the `eq('status', 'pending')` guard means a
    // replayed event is a no-op rather than a second settlement.
    const { data, error } = await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_amount_cents: session.amount_total ?? null,
        stripe_payment_intent_id: paymentIntentId,
        stripe_checkout_session_id: session.id,
      })
      .eq('id', invoiceId)
      .eq('status', 'pending')
      .select('id');

    if (error) throw new Error(`Marking invoice paid: ${error.message}`);

    if (!data?.length) {
      console.info('[stripe:webhook] invoice already settled, ignoring replay', invoiceId);
    } else {
      // Marking it paid removes it from the dunning engine's candidate set on
      // the next sweep — this is the AUTO-STOP.
      console.info('[stripe:webhook] invoice paid', invoiceId);
    }
    return;
  }

  if (kind === 'sms_credits') {
    const userId = session.metadata?.lefta_user_id;
    const credits = Number.parseInt(session.metadata?.credits ?? '', 10);

    if (!userId || !Number.isFinite(credits) || credits <= 0) {
      console.error('[stripe:webhook] malformed sms_credits metadata', session.id);
      return;
    }

    // `grant_sms_credits` keys on the session id, so replays grant nothing.
    const { data: granted, error } = await admin.rpc('grant_sms_credits', {
      p_user_id: userId,
      p_credits: credits,
      p_amount_cents: session.amount_total ?? 0,
      p_session_id: session.id,
    });

    if (error) throw new Error(`Granting SMS credits: ${error.message}`);
    console.info('[stripe:webhook] sms credits', { userId, credits, granted });
  }
}
