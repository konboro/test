import { NextResponse } from 'next/server';

import { psuFromRequest } from '@/lib/bank/psu';
import { syncBankFeeds } from '@/lib/bank/sync';
import { getSessionUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Reads the bank now, from the dashboard.
 *
 * The same work the settings screen already triggered, behind the same shape as
 * the other two sources: POST, JSON back, no redirect. That is the whole reason
 * it exists — the dashboard lists all three sources side by side, and one of
 * them navigating away to settings while the other two answered in place would
 * make the odd one out look broken.
 *
 * Scoped to the caller's own tenant: `syncBankFeeds` filters on `user_id`, so
 * this can never reach into another creditor's accounts.
 *
 * A failure reports the provider's own words. Banks cap statement reads at
 * roughly four a day per account and this spends one, so somebody who has burnt
 * the day's allowance needs to be told that specifically rather than handed a
 * guess.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Customer-present, and said so. The nightly sweep passes no PSU context
  // because nobody is there; claiming otherwise would misstate to the bank why
  // their customer's account is being read.
  const result = await syncBankFeeds({ userId: user.id, psu: await psuFromRequest() });

  if (result.errors.length) {
    console.error('[bank:sync]', result.errors);
    const [first] = result.errors;
    return NextResponse.json(
      { error: (first?.error ?? 'unknown').slice(0, 200) },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    // `fetched` is what the bank returned before anything was dropped, and it is
    // carried separately from `creditsSeen` for a reason worth keeping: a
    // response whose shape does not match ours yields rows fetched and nothing
    // seen, which otherwise looks identical to an account with no money coming
    // in.
    fetched: result.fetched,
    settled: result.settled,
    queued: result.queued,
  });
}
