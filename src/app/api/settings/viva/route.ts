import { NextResponse } from 'next/server';
import { z } from 'zod';

import { encryptSecret } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { writableOrganization } from '@/lib/orgs/active';
import { accessToken, type VivaEnvironment } from '@/lib/viva/client';
import { getDictionary } from '@/lib/i18n';

export const runtime = 'nodejs';

const schema = z.object({
  client_id: z.string().trim().min(10).max(300),
  client_secret: z.string().trim().min(10).max(300),
  // Optional: a fresh account has a default source and orders book against it
  // without naming one. Only accounts with several sources need this.
  source_code: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Stores the tenant's Viva Smart Checkout credentials.
 *
 * The environment is detected rather than asked for. Viva runs two entirely
 * separate estates and a credential pair belongs to exactly one of them — the
 * other answers `invalid_client` — so the honest question has an answer we can
 * simply look up. Asking the operator instead would be asking them to restate
 * something they already told us by pasting, and getting it wrong produces an
 * authentication failure at the moment a debtor presses pay.
 *
 * Production is tried first so that a real credential is never filed as a demo
 * one on the strength of a lucky match.
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

  const { client_id: clientId, client_secret: clientSecret, source_code: sourceCode } = parsed.data;

  let environment: VivaEnvironment | null = null;
  let lastError = '';

  for (const candidate of ['production', 'demo'] as const) {
    try {
      await accessToken({ clientId, clientSecret, environment: candidate });
      environment = candidate;
      break;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  if (!environment) {
    return NextResponse.json(
      { error: t.forms.api.vivaRejected(lastError) },
      { status: 400 },
    );
  }

  const { error } = await createAdminClient()
    .from('users')
    .update({
      viva_client_id_enc: encryptSecret(clientId),
      viva_client_secret_enc: encryptSecret(clientSecret),
      viva_source_code: sourceCode,
      viva_environment: environment,
    })
    .eq('id', org.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reflected back so nobody discovers at go-live that the account has been
  // running on demo credentials all along.
  return NextResponse.json({ ok: true, environment });
}

export async function DELETE() {
  const org = await writableOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await createAdminClient()
    .from('users')
    .update({
      viva_client_id_enc: null,
      viva_client_secret_enc: null,
      viva_source_code: null,
    })
    .eq('id', org.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
