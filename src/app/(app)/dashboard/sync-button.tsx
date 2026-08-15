'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, ButtonLink } from '@/components/ui';

interface SyncResponse {
  ok?: boolean;
  error?: string;
  invoicesCreated?: number;
  debtorsCreated?: number;
  fetched?: number;
}

/** Triggers an on-demand myDATA pull and refreshes the server-rendered page. */
export function SyncButton({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (!configured) {
    return (
      <ButtonLink href="/settings" variant="secondary">
        Σύνδεση με myDATA
      </ButtonLink>
    );
  }

  async function sync() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/mydata/sync', { method: 'POST' });
      const body = (await response.json()) as SyncResponse;

      if (!response.ok || !body.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'Ο συγχρονισμός απέτυχε.' });
        return;
      }

      setMessage({
        tone: 'ok',
        text: `Ελήφθησαν ${body.fetched ?? 0} παραστατικά · ${body.invoicesCreated ?? 0} νέα · ${body.debtorsCreated ?? 0} νέοι πελάτες.`,
      });
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button onClick={sync} disabled={busy || pending}>
        {busy ? 'Συγχρονισμός…' : 'Συγχρονισμός myDATA'}
      </Button>
      {message ? (
        <p
          role="status"
          className={`text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
