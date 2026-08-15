import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appUrl } from '@/lib/env';
import { onBehalfOf, stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const schema = z.object({ token: z.string().min(16).max(128) });

/**
 * Creates the debtor-facing Checkout session.
 *
 * Public by design: the caller is an anonymous visitor holding a payment link.
 * The opaque `pay_token` is the only credential, and it grants nothing beyond
 * paying this one invoice — the amount is always taken from the database, never
 * from the request.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id, debtor_id, amount_cents, currency, status, invoice_number, series, mark')
    .eq('pay_token', parsed.data.token)
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
    admin
      .from('users')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('id', invoice.user_id)
      .maybeSingle(),
  ]);

  // The creditor collects on their own Stripe account. Without one there is no
  // one to pay — and lefta must not step in and take the money on their behalf.
  if (!creditor?.stripe_account_id || !creditor.stripe_charges_enabled) {
    return NextResponse.json(
      { error: 'Ο εκδότης δεν δέχεται προς το παρόν ηλεκτρονικές πληρωμές.' },
      { status: 409 },
    );
  }

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  // A *direct charge*: the session lives on the creditor's account and the funds
  // settle there. No application fee is taken, so lefta never appears in the
  // payment at all.
  const session = await stripe().checkout.sessions.create(
    {
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
      // Stripe expands `{CHECKOUT_SESSION_ID}` itself.
      success_url: `${appUrl()}/pay/${parsed.data.token}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pay/${parsed.data.token}`,
    },
    onBehalfOf(creditor.stripe_account_id),
  );

  await admin
    .from('invoices')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', invoice.id);

  return NextResponse.json({ url: session.url });
}
