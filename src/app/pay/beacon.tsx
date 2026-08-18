'use client';

import { useEffect } from 'react';

/**
 * Marks this pay-page render as seen by an actual browser.
 *
 * Runs after hydration on purpose: a mail scanner prefetching the URL gets the
 * page but does not execute it, so the funnel's `page_view` stays close to
 * "a person looked at this". The channel tag comes off the URL the reminder
 * carried (`?c=e` / `?c=s`); its absence is itself information — a typed or
 * forwarded visit.
 *
 * Renders nothing and must never break the page: the beacon is fire-and-forget.
 */
export function FunnelBeacon({ credential }: { credential: string }) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        token: credential,
        c: new URLSearchParams(window.location.search).get('c'),
      });

      if (!navigator.sendBeacon?.('/api/beacon', body)) {
        void fetch('/api/beacon', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    } catch {
      // Analytics never gets to break a payment page.
    }
  }, [credential]);

  return null;
}
