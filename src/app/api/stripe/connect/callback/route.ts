import { NextResponse, type NextRequest } from 'next/server';

import { appUrl } from '@/lib/env';
import { stripe } from '@/lib/stripe';
import { verifyConnectState } from '@/lib/stripe-connect';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(status: string) {
  return NextResponse.redirect(`${appUrl()}/settings?stripe=${status}#stripe`);
}

/** Completes the Connect handshake and stores the tenant's account id. */
export async function GET(request: NextRequest) {
  const org = await writableOrganization();
  if (!org) return NextResponse.redirect(`${appUrl()}/login`);

  const params = request.nextUrl.searchParams;

  // The tenant pressed "cancel" on Stripe's screen.
  if (params.get('error')) return back('cancelled');

  const code = params.get('code');
  const state = params.get('state') ?? '';

  if (!code) return back('failed');

  // Binds this callback to the tenant who started it — see lib/stripe-connect.
  if (!verifyConnectState(state, org.id)) {
    console.error('[stripe:connect] state rejected for user', org.id);
    return back('failed');
  }

  try {
    const token = await stripe().oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const accountId = token.stripe_user_id;
    if (!accountId) return back('failed');

    // Read the account back rather than assuming: a freshly created Standard
    // account often cannot take charges yet, and the payment page must not offer
    // a button that Stripe will refuse.
    const account = await stripe().accounts.retrieve(accountId);

    const { error } = await createAdminClient()
      .from('users')
      .update({
        stripe_account_id: accountId,
        stripe_charges_enabled: Boolean(account.charges_enabled),
        stripe_connected_at: new Date().toISOString(),
      })
      .eq('id', org.id);

    if (error) {
      // The unique index is the likely cause: one Stripe account cannot collect
      // for two different tenants, or reconciliation becomes guesswork.
      console.error('[stripe:connect] storing account failed', error.message);
      return back(error.code === '23505' ? 'already-linked' : 'failed');
    }

    return back(account.charges_enabled ? 'connected' : 'pending');
  } catch (cause) {
    console.error('[stripe:connect] token exchange failed', String(cause));
    return back('failed');
  }
}
