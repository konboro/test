import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appUrl } from '@/lib/env';
import { stripe } from '@/lib/stripe';
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

  const { data: debtor } = await admin
    .from('debtors')
    .select('email, name')
    .eq('id', invoice.debtor_id)
    .maybeSingle();

  const label =
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  const session = await stripe().checkout.sessions.create({
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
  });

  await admin
    .from('invoices')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', invoice.id);

  return NextResponse.json({ url: session.url });
}
