'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

/**
 * Starts a payment for this invoice.
 *
 * Which provider serves it is the server's business. The button asks for a URL
 * and follows it, so a creditor switching from Stripe to Viva changes nothing
 * here and the debtor learns the provider only when they land on it.
 */
export function PayButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/pay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const body = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !body.url) {
        setError(body.error ?? 'Δεν ήταν δυνατή η έναρξη της πληρωμής. Δοκιμάστε ξανά.');
        setBusy(false);
        return;
      }

      window.location.href = body.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={pay} disabled={busy} variant="brand" className="w-full py-3 text-base">
        {busy ? 'Ανακατεύθυνση…' : 'Πληρωμή τώρα'}
      </Button>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </>
  );
}
