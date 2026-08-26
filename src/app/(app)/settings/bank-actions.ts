'use server';

import { redirect } from 'next/navigation';

import { psuFromRequest } from '@/lib/bank/psu';
import { syncBankFeeds } from '@/lib/bank/sync';
import { writableOrganization } from '@/lib/orgs/active';


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
 *
 * A failure reports the provider's own words. Guessing at the cause is worse
 * than saying "this is what came back", because a plausible wrong diagnosis
 * sends the operator off to fix something that was never broken.
 */
export async function syncBankNow(): Promise<void> {
  const org = await writableOrganization();
  // Read-only members may look at the bank card; they may not press sync.
  if (!org) redirect('/settings?bank=forbidden');

  // Customer-present, and said so. The nightly sweep passes no PSU context
  // because nobody is there — claiming otherwise would misstate to the bank why
  // their customer's account is being read.
  const result = await syncBankFeeds({ userId: org.id, psu: await psuFromRequest() });

  if (result.errors.length) {
    // Say what actually went wrong. The first version of this mapped every
    // failure to "the banks limit daily checks", which is one possible cause
    // among many — a confident wrong answer that sends someone away to wait for
    // a limit that was never the problem. The provider's own message is the
    // only honest thing to show, and it also reaches the server log.
    const [first] = result.errors;
    console.error('[bank:sync]', result.errors);

    const params = new URLSearchParams({
      bank: 'sync_failed',
      reason: (first?.error ?? 'unknown').slice(0, 200),
    });
    redirect(`/settings?${params}#bank`);
  }

  const params = new URLSearchParams({
    bank: 'synced',
    // What the bank returned before anything was dropped. Carried separately
    // from `seen` because the two differ for a reason worth naming: `toCredit`
    // discards a row the moment a field it needs is missing, so a response whose
    // shape does not match ours yields rows fetched and nothing seen — which
    // otherwise looks identical to an account with no money coming in.
    fetched: String(result.fetched),
    seen: String(result.creditsSeen),
    settled: String(result.settled),
    queued: String(result.queued),
    accounts: String(result.connectionsChecked),
  });

  redirect(`/settings?${params}#bank`);
}
