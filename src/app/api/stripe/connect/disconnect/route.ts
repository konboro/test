import { NextResponse } from 'next/server';

import { saveFailed } from '@/lib/errors';
import { connectClientId, stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';
import { getDictionary } from '@/lib/i18n';

export const runtime = 'nodejs';

/**
 * Unlinks the tenant's Stripe account.
 *
 * Revokes lefta's access at Stripe first, then clears the local record. Doing it
 * in that order means a failure leaves the tenant still connected and able to
 * retry, rather than locally disconnected while lefta silently retains API
 * access to their account.
 *
 * Invoices already paid keep their payment intent ids — those live on the
 * tenant's own account and remain their record.
 */
export async function POST() {
  const t = await getDictionary();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('users')
    .select('stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.stripe_account_id) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  try {
    await stripe().oauth.deauthorize({
      client_id: connectClientId(),
      stripe_user_id: profile.stripe_account_id,
    });
  } catch (cause) {
    // Already revoked from the Stripe dashboard: nothing left to revoke, so
    // clearing our side is still the right outcome.
    const message = String(cause);
    if (!message.includes('not connected')) {
      console.error('[stripe:connect] deauthorize failed', message);
      return NextResponse.json({ error: t.forms.api.disconnectFailed }, { status: 502 });
    }
  }

  const { error } = await admin
    .from('users')
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_connected_at: null,
    })
    .eq('id', user.id);

  if (error) {
    // The store refused, which is ours to fix and nothing the reader can act
    // on. The provider's own words are still passed on above, where they are
    // the only true account of why a key was rejected.
    return NextResponse.json(
      { error: saveFailed(await getDictionary(), 'stripe:disconnect', error) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
