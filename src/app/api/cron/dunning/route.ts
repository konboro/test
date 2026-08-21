import { NextResponse, type NextRequest } from 'next/server';

import { syncBankFeeds } from '@/lib/bank/sync';
import { safeEqual } from '@/lib/crypto';
import { runDunningSweep } from '@/lib/dunning/engine';
import { generateRentCharges } from '@/lib/leases/generate';
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
    // Read the bank first, chase second. An invoice paid by transfer yesterday
    // has to leave the candidate set *before* the sweep considers it, or the
    // debtor is chased for money that already arrived.
    //
    // A dry run skips it: settling an invoice is a real mutation and "dry" has
    // to mean nothing changed. And a failure here is logged, never fatal — the
    // ladder is the product, the feed is an improvement on top of it.
    // Rent first, then the bank, then the chase: create what is owed, settle
    // what arrived, chase what is left. Generating before the feed also gives
    // a tenant who paid early something for the matcher to recognise — the
    // other order leaves that transfer sitting in the review queue with no
    // charge to belong to.
    //
    // Skipped on a dry run for the same reason the bank sync is: writing a
    // charge is a real mutation, and "dry" has to mean nothing changed.
    let rent = null;
    if (!dryRun) {
      try {
        rent = await generateRentCharges();
        console.info('[cron:rent]', rent);
      } catch (cause) {
        // Never fatal. A landlord losing this month’s charge is bad; the whole
        // sweep failing for every other tenant because of it is worse.
        console.error('[cron:rent] failed', String(cause));
      }
    }

    let bank = null;
    if (!dryRun) {
      try {
        bank = await syncBankFeeds();
        console.info('[cron:bank]', bank);
      } catch (cause) {
        console.error('[cron:bank] failed', String(cause));
      }
    }

    const result = await runDunningSweep({ dryRun });
    console.info('[cron:dunning]', result);
    return NextResponse.json({ ok: true, ...result, rent, bank });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron:dunning] failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
