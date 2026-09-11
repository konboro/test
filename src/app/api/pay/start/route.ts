import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';

import { appUrl } from '@/lib/env';
import { dictionaryFor } from '@/lib/i18n';
import { resolveDebtorLocale, tenantLocale } from '@/lib/i18n/message-locale';
import { channelFromTag, recordFunnelEvent } from '@/lib/funnel/events';
import { PAY_CODE_LENGTH, payCredentialColumn, payPath } from '@/lib/pay-code';
import {
  PAYMENT_COLUMNS,
  providerFor,
  revolutCredentialsFor,
  vivaCredentialsFor,
} from '@/lib/payments/provider';
import { createOrder as createRevolutOrder } from '@/lib/revolut/client';
import { paymentsFor } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkoutUrl, createOrder } from '@/lib/viva/client';

export const runtime = 'nodejs';

// Either credential: a short code or a 48-character legacy token. Alphanumeric
// only, so nothing that reaches the query filter can carry syntax with it.
const schema = z.object({
  token: z
    .string()
    .min(PAY_CODE_LENGTH)
    .max(128)
    .regex(/^[A-Za-z0-9]+$/),
  // The channel tag the reminder link carried (?c=e / ?c=s). Statistics only:
  // it labels the funnel's checkout_started event and decides nothing.
  c: z.string().max(8).nullish(),
});

/**
 * Starts a payment for one invoice and returns where to send the debtor.
 *
 * Public by design: the caller is an anonymous visitor holding a payment link.
 * The credential in that link is the only thing they hold, and it grants nothing
 * beyond paying this one invoice — the amount is always taken from the database,
 * never from the request.
 *
 * Which provider serves it is decided here rather than in the browser, so the
 * debtor never learns the creditor's arrangement before the redirect lands them
 * on it, and a caller cannot ask for a provider the creditor has not set up.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const token = parsed.data.token;
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, debtor_id, amount_cents, currency, status, invoice_number, series, mark')
    .eq(payCredentialColumn(token), token)
    .maybeSingle();

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'already_paid' }, { status: 409 });
  }
  if (invoice.status !== 'pending') {
    return NextResponse.json({ error: 'not_payable' }, { status: 409 });
  }

  const [{ data: debtor }, { data: creditor }] = await Promise.all([
    admin
      .from('debtors')
      .select('email, name, locale, phone')
      .eq('id', invoice.debtor_id)
      .maybeSingle(),
    admin
      .from('users')
      .select(`${PAYMENT_COLUMNS}, locale`)
      .eq('id', invoice.user_id)
      .maybeSingle(),
  ]);

  // What the debtor reads on the provider's checkout, and afterwards on their
  // card statement: their own language, resolved the same way the reminder that
  // brought them here was.
  const creditorLocale = tenantLocale({ locale: creditor?.locale ?? null });
  const t = dictionaryFor(
    debtor ? resolveDebtorLocale(debtor, creditorLocale) : creditorLocale,
  ).pay;

  // Whatever the arrangement, the money lands on the creditor's own account and
  // nothing settles to lefta. Without one there is nobody to pay — and lefta
  // must not step in and take it on their behalf.
  const provider = creditor ? providerFor(creditor) : null;

  if (!provider) {
    return NextResponse.json(
      { error: 'provider_missing' },
      { status: 409 },
    );
  }

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  if (provider === 'revolut') {
    const credentials = revolutCredentialsFor(creditor!);
    if (!credentials) {
      return NextResponse.json({ error: 'provider_missing' }, { status: 409 });
    }

    let order;
    try {
      order = await createRevolutOrder(credentials, {
        amountCents: invoice.amount_cents,
        currency: invoice.currency,
        description: t.orderDescription(label),
        // Ours, and the whole binding: the return route settles only an order
        // whose reference names this invoice.
        reference: invoice.id,
        customerEmail: debtor?.email ?? null,
        // Per order — so the debtor comes back to their own payment page
        // rather than to a static address configured by hand.
        redirectUrl: `${appUrl()}/api/revolut/return?token=${token}`,
      });
    } catch (cause) {
      console.error('[pay:start] Revolut refused the order', String(cause));
      return NextResponse.json(
        { error: 'start_failed' },
        { status: 502 },
      );
    }

    if (!order.checkoutUrl) {
      console.error('[pay:start] Revolut order without a checkout url', order.id);
      return NextResponse.json(
        { error: 'start_failed' },
        { status: 502 },
      );
    }

    // Recorded before the debtor is sent anywhere: an order the database does
    // not know about can never settle. Every order is kept — a second press of
    // Pay must not orphan a first one that is still payable — and the amount
    // stored here is what Revolut will charge.
    const { error: recordError } = await admin.from('revolut_orders').insert({
      order_id: order.id,
      user_id: invoice.user_id,
      invoice_id: invoice.id,
      amount_cents: invoice.amount_cents,
    });

    if (recordError) {
      console.error('[pay:start] revolut_orders write failed', recordError.message);
      return NextResponse.json(
        { error: 'start_failed' },
        { status: 502 },
      );
    }

    await recordFunnelEvent({
      userId: invoice.user_id,
      invoiceId: invoice.id,
      debtorId: invoice.debtor_id,
      channel: channelFromTag(parsed.data.c),
      event: 'checkout_started',
    });

    return NextResponse.json({ url: order.checkoutUrl });
  }

  if (provider === 'viva') {
    // Viva books the order in the merchant wallet's currency and the order
    // payload carries no currency field, so a non-EUR document would be charged
    // as face-value euros and then marked fully paid. Refuse instead.
    //
    // Reported as itself rather than as "the issuer takes no card payments".
    // That is a different problem with a different answer: this one is settled
    // by paying another way, not by the creditor configuring something.
    if (invoice.currency.toUpperCase() !== 'EUR') {
      return NextResponse.json({ error: 'currency_unsupported' }, { status: 409 });
    }

    const credentials = vivaCredentialsFor(creditor!);
    if (!credentials) {
      return NextResponse.json({ error: 'provider_missing' }, { status: 409 });
    }

    let orderCode: string;
    try {
      orderCode = await createOrder(credentials, {
        amountCents: invoice.amount_cents,
        customerTrns: t.orderDescription(label),
        customerEmail: debtor?.email ?? null,
        merchantTrns: `lefta ${label}`,
      });
    } catch (cause) {
      // A mistyped source code or a revoked credential surfaces here, at the
      // first press — as a message the debtor can act on, not a bare 500.
      console.error('[pay:start] Viva refused the order', String(cause));
      return NextResponse.json(
        { error: 'start_failed' },
        { status: 502 },
      );
    }

    // Recorded before the debtor is sent anywhere: a checkout the database does
    // not know about can never settle. Two writes on purpose — viva_orders keeps
    // EVERY order this invoice ever minted (a second press must not orphan a
    // first order that is still payable), and the invoice column keeps pointing
    // at the latest one for the timeline and as the pre-migration fallback.
    const { error: recordError } = await admin.from('viva_orders').insert({
      order_code: orderCode,
      user_id: invoice.user_id,
      invoice_id: invoice.id,
      amount_cents: invoice.amount_cents,
    });
    const { error: pointerError } = await admin
      .from('invoices')
      .update({ viva_order_code: orderCode })
      .eq('id', invoice.id);

    if (recordError) console.error('[pay:start] viva_orders write failed', recordError.message);
    if (pointerError) console.error('[pay:start] viva pointer write failed', pointerError.message);

    // Either write alone is enough to resolve the payment on return. Both
    // failing means the checkout would be untraceable — the debtor could pay
    // and nothing would ever settle — so they must not be sent there.
    if (recordError && pointerError) {
      return NextResponse.json(
        { error: 'start_failed' },
        { status: 502 },
      );
    }

    await recordFunnelEvent({
      userId: invoice.user_id,
      invoiceId: invoice.id,
      debtorId: invoice.debtor_id,
      channel: channelFromTag(parsed.data.c),
      event: 'checkout_started',
    });

    return NextResponse.json({ url: checkoutUrl(credentials.environment, orderCode) });
  }

  const payments = paymentsFor(creditor!);
  if (payments.kind === 'none') {
    return NextResponse.json(
      { error: 'provider_missing' },
      { status: 409 },
    );
  }

  // Either way this is a charge on the creditor's own account: through Connect
  // it is a direct charge, through their key it is simply their account. No
  // application fee is taken, so lefta never appears in the payment at all.
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: invoice.currency.toLowerCase(),
          unit_amount: invoice.amount_cents,
          product_data: { name: t.orderDescription(label) },
        },
      },
    ],
    ...(debtor?.email ? { customer_email: debtor.email } : {}),
    metadata: {
      kind: 'invoice_payment',
      invoice_id: invoice.id,
      lefta_user_id: invoice.user_id,
    },
    // Returns through our confirm endpoint, which verifies the session with
    // Stripe and settles the invoice before showing the page — that is what makes
    // payment work for a tenant with no webhook pointed at us. It then sends the
    // visitor back to the URL shape they arrived on, short or legacy.
    // Stripe expands `{CHECKOUT_SESSION_ID}` itself.
    success_url: `${appUrl()}/api/stripe/confirm?token=${token}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}${payPath(token)}`,
  };

  // Passing options at all is conditional: see TenantPayments in lib/stripe.
  let session;
  try {
    session = payments.options
      ? await payments.client.checkout.sessions.create(params, payments.options)
      : await payments.client.checkout.sessions.create(params);
  } catch (cause) {
    // A revoked key or a disabled account fails here; the debtor gets a message
    // they can retry on rather than a bare 500.
    console.error('[pay:start] Stripe refused the session', String(cause));
    return NextResponse.json(
      { error: 'start_failed' },
      { status: 502 },
    );
  }

  await admin
    .from('invoices')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', invoice.id);

  await recordFunnelEvent({
    userId: invoice.user_id,
    invoiceId: invoice.id,
    debtorId: invoice.debtor_id,
    channel: channelFromTag(parsed.data.c),
    event: 'checkout_started',
  });

  return NextResponse.json({ url: session.url });
}
