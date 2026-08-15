import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appUrl } from '@/lib/env';
import { findPack, stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const schema = z.object({ pack: z.string() });

/** Creates a Stripe Checkout session for an SMS credit bundle. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const pack = findPack(parsed.data.pack);
  if (!pack) return NextResponse.json({ error: 'Unknown credit pack' }, { status: 400 });

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from('users')
    .select('id, email, company_name, stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (!tenant) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  // Reuse the tenant's Stripe customer so purchases and receipts stay together.
  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: tenant.email,
      name: tenant.company_name ?? undefined,
      metadata: { lefta_user_id: tenant.id },
    });
    customerId = customer.id;
    await admin.from('users').update({ stripe_customer_id: customerId }).eq('id', tenant.id);
  }

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: pack.amountCents,
          product_data: {
            name: `lefta.app — ${pack.label}`,
            description: `${pack.credits} SMS credits for automated payment reminders`,
          },
        },
      },
    ],
    // Read back by the webhook to decide what to grant.
    metadata: {
      kind: 'sms_credits',
      lefta_user_id: tenant.id,
      credits: String(pack.credits),
      pack: pack.id,
    },
    success_url: `${appUrl()}/settings?credits=success`,
    cancel_url: `${appUrl()}/settings?credits=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
