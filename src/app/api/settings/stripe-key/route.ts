import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';

import { encryptSecret } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const schema = z.object({
  secret_key: z
    .string()
    .trim()
    .min(10)
    .max(200)
    .refine((k) => k.startsWith('sk_') || k.startsWith('rk_'), {
      message: 'Το κλειδί πρέπει να ξεκινά με sk_ ή rk_.',
    }),
});

/**
 * Stores the tenant's own Stripe secret key.
 *
 * A bridge until lefta has a Stripe account of its own to run Connect from.
 * The key is encrypted with the same envelope as the myDATA and Elorus ones and
 * is never read back to the browser.
 *
 * It is verified before being stored: a key that cannot even read its own
 * account balance would otherwise fail silently, and the first anyone would
 * learn of it is a debtor pressing a payment button that breaks.
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

  const key = parsed.data.secret_key;

  try {
    const client = new Stripe(key, { apiVersion: '2025-02-24.acacia', typescript: true });
    await client.balance.retrieve();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: `Το Stripe απέρριψε το κλειδί: ${message}` }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('users')
    .update({ stripe_secret_key_enc: encryptSecret(key) })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Test keys are obvious from their prefix and worth reflecting back, so
  // nobody discovers at go-live that the account has been running on one.
  return NextResponse.json({ ok: true, testMode: key.startsWith('sk_test_') || key.startsWith('rk_test_') });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await createAdminClient()
    .from('users')
    .update({ stripe_secret_key_enc: null })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
