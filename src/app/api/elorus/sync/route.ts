import { NextResponse } from 'next/server';

import { ElorusError } from '@/lib/elorus/client';
import { syncElorusForUser } from '@/lib/elorus/sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Pulls the signed-in tenant's customers and documents from Elorus. */
export async function POST() {
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from('users')
    .select('*')
    .eq('id', org.id)
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (!tenant.elorus_api_key_enc || !tenant.elorus_organization_id) {
    return NextResponse.json(
      { error: 'Connect Elorus in Settings first.' },
      { status: 400 },
    );
  }

  try {
    const result = await syncElorusForUser(tenant);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    const message = cause instanceof ElorusError ? cause.message : String(cause);
    console.error('[elorus:sync] failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
