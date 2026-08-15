import { NextResponse } from 'next/server';
import { z } from 'zod';

import { encryptSecret } from '@/lib/crypto';
import { verifyCredentials } from '@/lib/elorus/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const schema = z.object({
  organization_id: z.string().trim().min(1, 'Organization ID is required').max(64),
  // Empty means "keep the key already stored", matching the myDATA form.
  api_key: z.string().trim().max(200).optional(),
});

/**
 * Stores the tenant's Elorus credentials.
 *
 * The key is encrypted before it reaches the database and is never read back to
 * the browser, exactly like the myDATA subscription key. Credentials are always
 * verified against the API first: a wrong organization id produces a bare 403
 * that is otherwise indistinguishable from a permissions problem, and finding
 * that out at save time is far cheaper than at sync time.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const { organization_id, api_key } = parsed.data;
  const admin = createAdminClient();

  let key = api_key?.trim() || null;

  if (!key) {
    const { data: existing } = await admin
      .from('users')
      .select('elorus_api_key_enc')
      .eq('id', user.id)
      .maybeSingle();

    if (!existing?.elorus_api_key_enc) {
      return NextResponse.json(
        { error: 'An API key is required the first time you connect Elorus.' },
        { status: 400 },
      );
    }

    const { decryptSecret } = await import('@/lib/crypto');
    key = decryptSecret(existing.elorus_api_key_enc);
  }

  const check = await verifyCredentials({ apiKey: key, organizationId: organization_id });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { error } = await admin
    .from('users')
    .update({
      elorus_organization_id: organization_id,
      ...(api_key?.trim() ? { elorus_api_key_enc: encryptSecret(api_key.trim()) } : {}),
    })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** Disconnects Elorus and wipes the stored key. */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await createAdminClient()
    .from('users')
    .update({
      elorus_api_key_enc: null,
      elorus_organization_id: null,
      elorus_last_sync_at: null,
    })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
