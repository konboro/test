import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';

import { appUrl } from '@/lib/env';
import { channelFromTag, recordFunnelEvent } from '@/lib/funnel/events';
import { PAY_CODE_LENGTH, payCredentialColumn, payPath } from '@/lib/pay-code';
import { PAYMENT_COLUMNS, providerFor, vivaCredentialsFor } from '@/lib/payments/provider';
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
    return NextResponse.json({ error: 'This invoice has already been paid.' }, { status: 409 });
  }
  if (invoice.status !== 'pending') {
    return NextResponse.json({ error: 'This invoice is no longer payable.' }, { status: 409 });
  }

  const [{ data: debtor }, { data: creditor }] = await Promise.all([
    admin.from('debtors').select('email, name').eq('id', invoice.debtor_id).maybeSingle(),
    admin.from('users').select(PAYMENT_COLUMNS).eq('id', invoice.user_id).maybeSingle(),
  ]);

  // Whatever the arrangement, the money lands on the creditor's own account and
  // nothing settles to lefta. Without one there is nobody to pay — and lefta
  // must not step in and take it on their behalf.
  const provider = creditor ? providerFor(creditor) : null;

  if (!provider) {
    return NextResponse.json(
      { error: 'Ο εκδότης δεν δέχεται προς το παρόν ηλεκτρονικές πληρωμές.' },
      { status: 409 },
    );
  }

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  if (provider === 'viva') {
    const credentials = vivaCredentialsFor(creditor!);
    if (!credentials) {
      return NextResponse.json({ error: 'Viva is not configured.' }, { status: 409 });
    }

    const orderCode = await createOrder(credentials, {
      amountCents: invoice.amount_cents,
      customerTrns: `Παραστατικό ${label}`,
      merchantTrns: `lefta ${label}`,
      customerEmail: debtor?.email ?? null,
    });

    // Stored before the debtor is sent anywhere. The return route settles only a
    // transaction whose order code matches this one, so an order that was never
    // recorded can never settle anything.
    await admin.from('invoices').update({ viva_order_code: orderCode }).eq('id', invoice.id);

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
      { error: 'Ο εκδότης δεν δέχεται προς το παρόν ηλεκτρονικές πληρωμές.' },
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
          product_data: { name: `Παραστατικό ${label}` },
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
  const session = payments.options
    ? await payments.client.checkout.sessions.create(params, payments.options)
    : await payments.client.checkout.sessions.create(params);

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
