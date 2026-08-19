import { headers } from 'next/headers';

import type { PsuContext } from '@/lib/bank/client';

/**
 * The browser actually asking for this, as the bank needs to see it.
 *
 * PSD2 exempts a read the account holder personally asked for from the daily cap
 * that unattended polling is subject to, and `PSU-IP-Address` is the only thing
 * that distinguishes the two. Without it Eurobank answers "The access on the
 * account has been exceeding the consented multiplicity per day" — which is what
 * pressing the sync button was doing.
 *
 * `x-forwarded-for` is a list when proxies chain; the client is the first entry.
 * Returns null rather than a placeholder when there is nothing credible: sending
 * a made-up address would assert a customer is present when we cannot show one.
 *
 * Shared by the settings action and the dashboard's sync route. It was private
 * to the action until the second caller appeared, and a second copy of a rule
 * this subtle is a copy that drifts.
 */
export async function psuFromRequest(): Promise<PsuContext | null> {
  const h = await headers();

  const forwarded = h.get('x-forwarded-for') ?? '';
  const ipAddress = (forwarded.split(',')[0] ?? '').trim() || h.get('x-real-ip')?.trim() || '';

  if (!ipAddress) return null;

  return { ipAddress, userAgent: h.get('user-agent') };
}
