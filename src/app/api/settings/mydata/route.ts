import { NextResponse } from 'next/server';
import { z } from 'zod';

import { encryptSecret } from '@/lib/crypto';
import { verifyCredentials } from '@/lib/mydata/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';
import type { UserRow } from '@/types/database';

export const runtime = 'nodejs';

const schema = z.object({
  mydata_user_id: z.string().trim().min(1, 'User ID is required').max(200),
  // Optional: an empty value means "keep the key already stored".
  subscription_key: z.string().trim().max(500).optional(),
  environment: z.enum(['production', 'sandbox']),
  verify: z.boolean().optional(),
});

/**
 * Stores the tenant's myDATA credentials.
 *
 * The subscription key is encrypted before it touches the database and is never
 * read back to the browser — the settings UI only ever shows a masked hint.
 */
export async function POST(request: Request) {
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const { mydata_user_id, subscription_key, environment, verify } = parsed.data;
  const admin = createAdminClient();

  // Resolve the key to use: the newly supplied one, or the stored one.
  let plaintextKey = subscription_key?.trim() || null;

  if (!plaintextKey) {
    const { data: existing } = await admin
      .from('users')
      .select('mydata_subscription_key_enc')
      .eq('id', org.id)
      .maybeSingle();

    if (!existing?.mydata_subscription_key_enc) {
      return NextResponse.json(
        { error: 'A subscription key is required the first time you connect myDATA.' },
        { status: 400 },
      );
    }
    // Nothing new to store; keep the ciphertext as-is.
    plaintextKey = null;
  }

  if (verify) {
    const { decryptSecret } = await import('@/lib/crypto');
    let keyForCheck = plaintextKey;

    if (!keyForCheck) {
      const { data } = await admin
        .from('users')
        .select('mydata_subscription_key_enc')
        .eq('id', org.id)
        .single();
      keyForCheck = decryptSecret(data!.mydata_subscription_key_enc!);
    }

    const check = await verifyCredentials({
      userId: mydata_user_id,
      subscriptionKey: keyForCheck,
      environment,
    });

    if (!check.ok) {
      return NextResponse.json({ error: `myDATA rejected these credentials: ${check.error}` }, { status: 400 });
    }
  }

  const update: Partial<UserRow> = {
    mydata_user_id,
    mydata_environment: environment,
    // Only overwrite the stored ciphertext when a new key was actually supplied.
    ...(plaintextKey ? { mydata_subscription_key_enc: encryptSecret(plaintextKey) } : {}),
  };

  const { error } = await admin.from('users').update(update).eq('id', org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, verified: verify === true });
}

/** Disconnects myDATA and wipes the stored key. */
export async function DELETE() {
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await createAdminClient()
    .from('users')
    .update({ mydata_user_id: null, mydata_subscription_key_enc: null })
    .eq('id', org.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
