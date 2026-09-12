import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { optionalEnv } from '@/lib/env';
import { notifyPaymentReceived } from '@/lib/payments/notify';
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

  const event = verify(payload, signature);
  if (!event) {
    return NextResponse.json({ error: 'Webhook signature failed' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCompletedSession(event.data.object, event.account ?? null);
        break;

      case 'account.updated':
        // Onboarding finishes asynchronously, and Stripe can also disable a
        // previously good account. Keeping the mirror current is what stops the
        // payment page offering a button Stripe would refuse.
        await handleAccountUpdated(event.data.object);
        break;

      case 'account.application.deauthorized':
        // The tenant disconnected us from their own Stripe dashboard rather
        // than from Settings here. Without this we would go on believing they
        // are connected and keep offering debtors a payment button that fails.
        await handleDeauthorized(event.account ?? null);
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

/**
 * Verifies against both possible endpoints.
 *
 * Invoice payments are direct charges, so their events originate on the
 * creditor's connected account; SMS credit purchases happen on the platform
 * account. Stripe signs each with the secret of the endpoint it was delivered
 * to, and the two can be configured separately. Trying both means either layout
 * works — one endpoint with "events on connected accounts" enabled, or two
 * endpoints with their own secrets.
 */
function verify(payload: string, signature: string): Stripe.Event | null {
  const secrets = [
    optionalEnv('STRIPE_WEBHOOK_SECRET'),
    optionalEnv('STRIPE_CONNECT_WEBHOOK_SECRET'),
  ].filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    console.error('[stripe:webhook] no webhook secret configured');
    return null;
  }

  for (const secret of secrets) {
    try {
      return stripe().webhooks.constructEvent(payload, signature, secret);
    } catch {
      // Try the next secret before giving up.
    }
  }

  console.error('[stripe:webhook] signature matched none of the configured secrets');
  return null;
}

async function handleDeauthorized(account: string | null) {
  if (!account) return;

  const { error } = await createAdminClient()
    .from('users')
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_connected_at: null,
    })
    .eq('stripe_account_id', account);

  if (error) throw new Error(`Clearing a deauthorized account: ${error.message}`);
}

async function handleAccountUpdated(account: Stripe.Account) {
  const { error } = await createAdminClient()
    .from('users')
    .update({ stripe_charges_enabled: Boolean(account.charges_enabled) })
    .eq('stripe_account_id', account.id);

  if (error) throw new Error(`Updating connected account: ${error.message}`);
}

async function handleCompletedSession(session: Stripe.Checkout.Session, account: string | null) {
  // `paid` is the only status that settles funds; `unpaid`/`no_payment_required`
  // must not grant anything.
  if (session.payment_status !== 'paid') return;

  const kind = session.metadata?.kind;
  const admin = createAdminClient();

  if (kind === 'invoice_payment') {
    const invoiceId = session.metadata?.invoice_id;
    const tenantId = session.metadata?.lefta_user_id;

    if (!invoiceId || !tenantId) {
      console.error('[stripe:webhook] invoice_payment session without ids', session.id);
      return;
    }

    // Who owns this invoice is a question for the invoice, not for the payload.
    //
    // This used to look the tenant up by `session.metadata.lefta_user_id` and
    // compare that tenant's connected account against the event — both sides of
    // a comparison the sender controls. Any connected account could mint a
    // fifty-cent session naming somebody else's invoice, pay it, and close a
    // debt of any size on books they have never seen. The comment claimed to
    // prevent exactly that.
    //
    // Reading the invoice first takes the attacker out of the comparison: the
    // event's account must match the account of whoever actually owns the row.
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, user_id, amount_cents')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!invoice) {
      console.error('[stripe:webhook] session names an invoice that does not exist', invoiceId);
      return;
    }

    if (invoice.user_id !== tenantId) {
      console.error('[stripe:webhook] session metadata claims the wrong owner', {
        invoiceId,
        claimed: tenantId,
      });
      return;
    }

    const { data: creditor } = await admin
      .from('users')
      .select('stripe_account_id')
      .eq('id', invoice.user_id)
      .maybeSingle();

    if (!account || !creditor?.stripe_account_id || creditor.stripe_account_id !== account) {
      console.error('[stripe:webhook] account mismatch for invoice', {
        invoiceId,
        account,
      });
      return;
    }

    // A capture that does not cover the debt does not close it.
    //
    // An invoice can legitimately change while a checkout sits open — an
    // accounting correction raising it, say — and the old behaviour marked it
    // settled in full for whatever the stale session happened to capture.
    // Money that was never collected stopped being chased, silently. An
    // under-payment is now refused and logged instead of forgiven.
    const captured = session.amount_total ?? 0;

    if (captured < invoice.amount_cents) {
      console.error('[stripe:webhook] capture does not cover the invoice', {
        invoiceId,
        captured,
        owed: invoice.amount_cents,
      });
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
      await notifyPaymentReceived(invoiceId);
    }
    return;
  }

  if (kind === 'sms_credits') {
    // Credit packs are sold by lefta on the platform account. An event carrying
    // an account id is from a connected account, which must not be able to mint
    // itself credits by replaying this shape.
    if (account) {
      console.error('[stripe:webhook] sms_credits from a connected account', account);
      return;
    }

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
