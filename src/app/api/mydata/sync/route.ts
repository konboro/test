import { NextResponse } from 'next/server';

import { syncInvoicesForUser } from '@/lib/mydata/sync';
import { MyDataError } from '@/lib/mydata/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Pulls the signed-in tenant's issued documents from myDATA on demand. */
export async function POST() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from('users')
    .select('*')
    .eq('id', sessionUser.id)
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (!tenant.mydata_user_id || !tenant.mydata_subscription_key_enc) {
    return NextResponse.json(
      { error: 'Connect your myDATA credentials in Settings first.' },
      { status: 400 },
    );
  }

  try {
    const result = await syncInvoicesForUser(tenant);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    const message = cause instanceof MyDataError ? cause.message : String(cause);
    console.error('[mydata:sync] failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
