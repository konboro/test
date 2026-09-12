import { NextResponse, type NextRequest } from 'next/server';

import { bankingConfigured, startAuth } from '@/lib/bank/client';
import { appUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts the bank handshake for the signed-in creditor.
 *
 * A full-page navigation, like the Stripe Connect start route: the creditor is
 * sent to their own bank for strong authentication and comes back to
 * `/api/bank/callback`.
 *
 * The connection row is written *before* the redirect and its id travels as the
 * `state`. That way the callback has somewhere to land even if the creditor
 * abandons the flow at the bank, and an abandoned attempt is visibly `pending`
 * rather than invisible.
 */
export async function GET(request: NextRequest) {
  const org = await writableOrganization();
  if (!org) return NextResponse.redirect(`${appUrl()}/login`);

  const settings = `${appUrl()}/settings/sources`;
  if (!bankingConfigured()) return NextResponse.redirect(`${settings}?bank=unavailable`);

  const aspsp = request.nextUrl.searchParams.get('aspsp');
  const country = request.nextUrl.searchParams.get('country') ?? 'GR';
  if (!aspsp) return NextResponse.redirect(`${settings}?bank=missing_bank`);

  const admin = createAdminClient();

  const { data: connection, error } = await admin
    .from('bank_connections')
    .insert({
      user_id: org.id,
      institution_id: aspsp,
      institution_name: aspsp,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !connection) return NextResponse.redirect(`${settings}?bank=error`);

  // The bank caps this; asking for longer is refused rather than trimmed, so
  // 180 days matches what the Greek banks currently allow.
  const validUntil = new Date();
  validUntil.setUTCDate(validUntil.getUTCDate() + 180);

  try {
    const auth = await startAuth({
      aspspName: aspsp,
      country,
      redirectUrl: `${appUrl()}/api/bank/callback`,
      state: connection.id,
      validUntil,
    });

    await admin
      .from('bank_connections')
      .update({ authorization_id: auth.authorization_id })
      .eq('id', connection.id);

    return NextResponse.redirect(auth.url);
  } catch (cause) {
    console.error('[bank:start]', String(cause));
    await admin.from('bank_connections').delete().eq('id', connection.id);
    return NextResponse.redirect(`${settings}?bank=error`);
  }
}
