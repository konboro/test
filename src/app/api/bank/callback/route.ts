import { NextResponse, type NextRequest } from 'next/server';

import { createSession } from '@/lib/bank/client';
import { appUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the bank returns the creditor after strong authentication.
 *
 * Nothing here trusts the query string beyond using `state` as a lookup: the
 * `code` is exchanged with the provider, and the accounts we store are the ones
 * the provider reports back, not anything the browser claims.
 *
 * The row was created before the redirect, so an abandoned authorisation stays
 * `pending` and a completed one is filled in — a creditor who closes the bank
 * tab halfway leaves a visible half-finished connection rather than silence.
 */
export async function GET(request: NextRequest) {
  const settings = `${appUrl()}/settings`;
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');

  if (!state) return NextResponse.redirect(`${settings}?bank=error`);

  const admin = createAdminClient();

  const { data: connection } = await admin
    .from('bank_connections')
    .select('id, user_id, institution_name')
    .eq('id', state)
    .maybeSingle();

  if (!connection) return NextResponse.redirect(`${settings}?bank=error`);

  // The state is only a lookup key; the binding to a tenant is the session, the
  // same way the Stripe Connect callback checks the signed-in user. Without it,
  // any signed-in account holding another tenant's pending connection id could
  // finish the handshake and attach its own bank feed to them — and a foreign
  // feed does not just leak, it settles their invoices.
  const user = await getSessionUser();
  if (!user || connection.user_id !== user.id) {
    console.error('[bank:callback] session does not own this connection', connection.id);
    return NextResponse.redirect(`${settings}?bank=error`);
  }

  // The creditor declined at the bank, or the bank refused. Leave nothing
  // half-linked behind.
  if (!code) {
    await admin.from('bank_connections').delete().eq('id', connection.id);
    return NextResponse.redirect(`${settings}?bank=cancelled`);
  }

  try {
    const session = await createSession(code);
    const accounts = session.accounts ?? [];

    if (!accounts.length) {
      await admin.from('bank_connections').delete().eq('id', connection.id);
      return NextResponse.redirect(`${settings}?bank=no_accounts`);
    }

    const consentExpiresAt = session.access?.valid_until ?? null;

    // One row per account. The first fills in the row we already created; any
    // further accounts get their own, because each is synced and expires
    // independently.
    const [first, ...rest] = accounts;

    await admin
      .from('bank_connections')
      .update({
        account_id: first?.uid,
        status: 'active',
        consent_expires_at: consentExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);

    if (rest.length) {
      await admin.from('bank_connections').insert(
        rest.map((account) => ({
          user_id: connection.user_id,
          institution_id: connection.institution_name,
          institution_name: connection.institution_name,
          authorization_id: session.session_id,
          account_id: account.uid,
          status: 'active',
          consent_expires_at: consentExpiresAt,
        })),
      );
    }

    return NextResponse.redirect(`${settings}?bank=connected`);
  } catch (cause) {
    console.error('[bank:callback]', String(cause));
    return NextResponse.redirect(`${settings}?bank=error`);
  }
}
