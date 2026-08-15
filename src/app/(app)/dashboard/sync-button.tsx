'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, ButtonLink } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

interface SyncResponse {
  ok?: boolean;
  error?: string;
  invoicesCreated?: number;
  debtorsCreated?: number;
  fetched?: number;
  hasMore?: boolean;
}

/** Triggers an on-demand myDATA pull and refreshes the server-rendered page. */
export function SyncButton({ configured }: { configured: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (!configured) {
    return (
      <ButtonLink href="/settings" variant="secondary">
        {t.sync.connect}
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
        setMessage({ tone: 'error', text: body.error ?? t.sync.failed });
        return;
      }

      setMessage({
        tone: 'ok',
        text:
          t.sync.result(body.fetched ?? 0, body.invoicesCreated ?? 0, body.debtorsCreated ?? 0) +
          (body.hasMore ? ` ${t.sync.more}` : ''),
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
        {busy ? t.sync.running : t.sync.run}
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
