import { NextResponse } from 'next/server';
import { z } from 'zod';

import { saveFailed } from '@/lib/errors';
import { encryptSecret } from '@/lib/crypto';
import { getDictionary } from '@/lib/i18n';
import { verifyKey, type RevolutEnvironment } from '@/lib/revolut/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';

export const runtime = 'nodejs';

const schema = z.object({
  secret_key: z.string().trim().min(10).max(300),
});

/**
 * Stores the tenant's Revolut Merchant API key.
 *
 * The estate is detected rather than asked for, exactly as it is for Viva: a
 * key belongs to one of Revolut's two hosts and the other rejects it, so the
 * honest question has an answer we can look up. Asking the operator to restate
 * what they already told us by pasting is how a mismatch ends up discovered by
 * a debtor pressing Pay.
 *
 * Production is tried first, so a real key is never filed as a sandbox one on
 * the strength of a lucky match.
 */
export async function POST(request: Request) {
  const t = await getDictionary();
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const secretKey = parsed.data.secret_key;

  let environment: RevolutEnvironment | null = null;
  let lastError = '';

  for (const candidate of ['production', 'sandbox'] as const) {
    try {
      await verifyKey({ secretKey, environment: candidate });
      environment = candidate;
      break;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  if (!environment) {
    return NextResponse.json({ error: t.forms.api.revolutRejected(lastError) }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('users')
    .update({
      revolut_secret_key_enc: encryptSecret(secretKey),
      revolut_environment: environment,
    })
    .eq('id', org.id);

  if (error) {
    // The store refused, which is ours to fix and nothing the reader can act
    // on. The provider's own words are still passed on above, where they are
    // the only true account of why a key was rejected.
    return NextResponse.json(
      { error: saveFailed(await getDictionary(), 'settings:revolut', error) },
      { status: 500 },
    );
  }

  // Reflected back so nobody discovers at go-live that the account has been
  // running on a sandbox key all along.
  return NextResponse.json({ ok: true, environment });
}

export async function DELETE() {
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await createAdminClient()
    .from('users')
    .update({ revolut_secret_key_enc: null })
    .eq('id', org.id);

  if (error) {
    // The store refused, which is ours to fix and nothing the reader can act
    // on. The provider's own words are still passed on above, where they are
    // the only true account of why a key was rejected.
    return NextResponse.json(
      { error: saveFailed(await getDictionary(), 'settings:revolut', error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
