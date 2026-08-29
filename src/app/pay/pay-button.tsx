'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';
import type { PayCopy } from './copy';

/**
 * What the route's answer means, in the reader's language.
 *
 * The API answers with a code rather than a sentence. A sentence returned from
 * a route is written in whichever language the route happened to be written in,
 * which on this page was Greek regardless of who was reading it.
 */
function payError(t: PayCopy, code: string | undefined): string {
  switch (code) {
    case 'already_paid':
      return t.alreadyPaid;
    case 'not_payable':
      return t.notPayableNow;
    case 'provider_missing':
      return t.providerMissing;
    default:
      return t.startFailed;
  }
}

/**
 * Starts a payment for this invoice.
 *
 * Which provider serves it is the server's business. The button asks for a URL
 * and follows it, so a creditor switching from Stripe to Viva changes nothing
 * here and the debtor learns the provider only when they land on it.
 */
export function PayButton({ token, t }: { token: string; t: PayCopy }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/pay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          // The channel tag the reminder link carried, for the funnel's
          // checkout_started event. Annotation only — the server ignores it for
          // everything except statistics.
          c: new URLSearchParams(window.location.search).get('c'),
        }),
      });

      const body = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !body.url) {
        setError(payError(t, body.error));
        setBusy(false);
        return;
      }

      window.location.href = body.url;
    } catch (cause) {
      setError(t.startFailed);
      console.error('[pay] start', String(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={pay} disabled={busy} variant="brand" className="w-full py-3 text-base">
        {busy ? t.redirecting : t.payNow}
      </Button>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </>
  );
}
