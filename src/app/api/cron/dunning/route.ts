import { NextResponse, type NextRequest } from 'next/server';

import { safeEqual } from '@/lib/crypto';
import { runDunningSweep } from '@/lib/dunning/engine';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A full sweep across every tenant can take a while.
export const maxDuration = 300;

/**
 * Daily automation entry point.
 *
 * Scheduled by `vercel.json` (07:00 UTC ≈ 09:00/10:00 Athens). Any scheduler
 * works — it just has to present the shared secret.
 */
async function handle(request: NextRequest) {
  const expected = requireEnv('CRON_SECRET');

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';

  try {
    const result = await runDunningSweep({ dryRun });
    console.info('[cron:dunning]', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron:dunning] failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
