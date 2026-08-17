'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { PsuContext } from '@/lib/bank/client';
import { syncBankFeeds } from '@/lib/bank/sync';
import { getSessionUser } from '@/lib/supabase/server';

/**
 * The browser actually asking for this, as the bank needs to see it.
 *
 * PSD2 exempts a read the account holder personally asked for from the daily
 * cap that unattended polling is subject to, and `PSU-IP-Address` is the only
 * thing that distinguishes the two. Without it Eurobank answers
 * "The access on the account has been exceeding the consented multiplicity per
 * day" — which is what pressing this button was doing.
 *
 * `x-forwarded-for` is a list when proxies chain; the client is the first entry.
 * Returns null rather than a placeholder when there is nothing credible: sending
 * a made-up address would assert a customer is present when we cannot show one.
 */
async function psuFromRequest(): Promise<PsuContext | null> {
  const h = await headers();

  const forwarded = h.get('x-forwarded-for') ?? '';
  const ipAddress = (forwarded.split(',')[0] ?? '').trim() || h.get('x-real-ip')?.trim() || '';

  if (!ipAddress) return null;

  return { ipAddress, userAgent: h.get('user-agent') };
}

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
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Customer-present, and said so. The nightly sweep passes no PSU context
  // because nobody is there — claiming otherwise would misstate to the bank why
  // their customer's account is being read.
  const result = await syncBankFeeds({ userId: user.id, psu: await psuFromRequest() });

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
