import { NextResponse } from 'next/server';

import { appUrl } from '@/lib/env';
import { connectClientId } from '@/lib/stripe';
import { signConnectState } from '@/lib/stripe-connect';
import { writableOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends the tenant to Stripe to link their own account.
 *
 * Standard Connect: they sign in to the Stripe account they already have (or
 * create one there), and lefta ends up holding nothing but an account id. Their
 * customers' payments settle to them directly.
 */
export async function GET() {
  const org = await writableOrganization();
  if (!org) return NextResponse.redirect(`${appUrl()}/login`);

  // The company's own address, not the operator's: the Stripe account being
  // connected belongs to the creditor, and an accountant connecting it for a
  // client should not be prefilling their own email into the client's account.
  const supabase = await createClient();
  const { data: company } = await supabase.from('users').select('email').eq('id', org.id).maybeSingle();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: connectClientId(),
    scope: 'read_write',
    redirect_uri: `${appUrl()}/api/stripe/connect/callback`,
    state: signConnectState(org.id),
    'stripe_user[email]': company?.email ?? '',
  });

  return NextResponse.redirect(`https://connect.stripe.com/oauth/authorize?${params}`);
}
