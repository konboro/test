'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, ButtonLink, Card, CardHeader } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

export type SourceKey = 'billing' | 'mydata' | 'bank';

export interface SourceState {
  configured: boolean;
  lastSync: string | null;
}

/** Where each source is pulled from, and where it is set up when it is not. */
const ENDPOINTS: Record<SourceKey, { sync: string; settings: string }> = {
  billing: { sync: '/api/elorus/sync', settings: '/settings#elorus' },
  mydata: { sync: '/api/mydata/sync', settings: '/settings#mydata' },
  bank: { sync: '/api/bank/sync', settings: '/settings#bank' },
};

const ORDER: SourceKey[] = ['billing', 'mydata', 'bank'];

/**
 * Every source of data, in one place, with the same controls.
 *
 * Before this there were two buttons in the page header — the billing system and
 * myDATA — while the bank was synced from a button buried in settings, and the
 * "last synced" line under the title reported myDATA's time as though it spoke
 * for all of them. Three sources, two of them visible, one clock: an operator
 * had no way to tell which feed was stale.
 *
 * A source that is not connected says so and offers the way to connect it,
 * rather than vanishing. An absent row and a row that has never run look the
 * same from the outside, and only one of them is a problem you can fix.
 */
export function DataSources({ sources }: { sources: Record<SourceKey, SourceState> }) {
  const t = useT();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<SourceKey | null>(null);
  const [messages, setMessages] = useState<
    Partial<Record<SourceKey, { tone: 'ok' | 'error'; text: string }>>
  >({});

  const labels: Record<SourceKey, string> = {
    billing: t.sync.sourceBilling,
    mydata: t.sync.sourceMydata,
    bank: t.sync.sourceBank,
  };

  /**
   * Each endpoint answers with its own counts, so the sentence is built per
   * source rather than from a shared shape. Inventing a common envelope would
   * mean either flattening three genuinely different results into one vague
   * line, or changing three routes to satisfy a summary.
   */
  function describe(key: SourceKey, body: Record<string, number | boolean | undefined>): string {
    if (key === 'billing') {
      return t.sync.elorusResult(
        Number(body.contactsFetched ?? 0),
        Number(body.invoicesFetched ?? 0),
        Number(body.invoicesCreated ?? 0),
      );
    }

    if (key === 'bank') {
      return t.sync.bankResult(
        Number(body.fetched ?? 0),
        Number(body.settled ?? 0),
        Number(body.queued ?? 0),
      );
    }

    return (
      t.sync.result(
        Number(body.fetched ?? 0),
        Number(body.invoicesCreated ?? 0),
        Number(body.debtorsCreated ?? 0),
      ) + (body.hasMore ? ` ${t.sync.more}` : '')
    );
  }

  async function run(key: SourceKey) {
    setBusy(key);
    setMessages((current) => ({ ...current, [key]: undefined }));

    try {
      const response = await fetch(ENDPOINTS[key].sync, { method: 'POST' });
      const body = (await response.json()) as Record<string, never> & {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !body.ok) {
        setMessages((current) => ({
          ...current,
          [key]: { tone: 'error', text: body.error ?? t.sync.failed },
        }));
        return;
      }

      setMessages((current) => ({ ...current, [key]: { tone: 'ok', text: describe(key, body) } }));
      startTransition(() => router.refresh());
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [key]: {
          tone: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title={t.sync.sourcesTitle} subtitle={t.sync.sourcesHint} />

      <ul className="divide-y divide-ink-100">
        {ORDER.map((key) => {
          const source = sources[key];
          const message = messages[key];

          return (
            <li key={key} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{labels[key]}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {!source.configured
                      ? t.sync.notConnected
                      : source.lastSync
                        ? t.dashboard.lastSync(
                            new Date(source.lastSync).toLocaleString(t.dateTimeTag),
                          )
                        : t.dashboard.neverSynced}
                  </p>
                </div>

                {source.configured ? (
                  <Button
                    variant="secondary"
                    onClick={() => run(key)}
                    disabled={busy !== null || refreshing}
                  >
                    {busy === key ? t.sync.running : t.sync.syncNow}
                  </Button>
                ) : (
                  <ButtonLink href={ENDPOINTS[key].settings} variant="secondary">
                    {t.sync.connectSource}
                  </ButtonLink>
                )}
              </div>

              {message ? (
                <p
                  role="status"
                  className={`mt-2 text-xs leading-relaxed ${
                    message.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {message.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
