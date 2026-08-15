import { NextResponse } from 'next/server';

import { appUrl } from '@/lib/env';
import { connectClientId } from '@/lib/stripe';
import { signConnectState } from '@/lib/stripe-connect';
import { getSessionUser } from '@/lib/supabase/server';

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
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: connectClientId(),
    scope: 'read_write',
    redirect_uri: `${appUrl()}/api/stripe/connect/callback`,
    state: signConnectState(user.id),
    'stripe_user[email]': user.email ?? '',
  });

  return NextResponse.redirect(`https://connect.stripe.com/oauth/authorize?${params}`);
}
