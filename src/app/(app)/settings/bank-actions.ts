'use server';

import { redirect } from 'next/navigation';

import { syncBankFeeds } from '@/lib/bank/sync';
import { getSessionUser } from '@/lib/supabase/server';

/**
 * Reads the bank now, instead of waiting for tomorrow's sweep.
 *
 * The scheduled sync runs inside the dunning cron, and a dry run skips it, so
 * without this there is no way to pull a statement without also mailing every
 * reminder that happens to be due. That made the feature untestable against a
 * real account, which is the only way it can be tested at all.
 *
 * Scoped to the caller's own tenant. `syncBankFeeds` filters on `user_id`, so
 * pressing this can never reach into another creditor's accounts.
 *
 * Banks cap statement reads at roughly four a day per account, and this spends
 * one. That is the intended trade — a person waiting for an answer is exactly
 * the case the rate-limit rules exempt — but it is why the result is reported
 * rather than silently swallowed: someone who has burnt the day's allowance
 * needs to be told, not left pressing a button that does nothing.
 */
export async function syncBankNow(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await syncBankFeeds({ userId: user.id });

  if (result.errors.length) {
    redirect(`/settings?bank=sync_failed#bank`);
  }

  const params = new URLSearchParams({
    bank: 'synced',
    seen: String(result.creditsSeen),
    settled: String(result.settled),
    queued: String(result.queued),
  });

  redirect(`/settings?${params}#bank`);
}
