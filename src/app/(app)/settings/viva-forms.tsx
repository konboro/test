'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

/**
 * The tenant's own Viva.com Smart Checkout credentials.
 *
 * Same arrangement as the Stripe key and the copy says so: the money lands on
 * their Viva account and lefta never appears in the payment. Viva has no
 * Connect-style handshake available to us, so pasted credentials are the whole
 * mechanism rather than a stopgap.
 *
 * The environment is not asked for. A credential pair belongs to exactly one of
 * Viva's two estates and the other rejects it, so the server finds out by trying
 * and reports back which one it was.
 */
export function VivaForm({
  configured,
  environment,
  sourceCode,
}: {
  configured: boolean;
  environment: string;
  sourceCode: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/viva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: String(formData.get('client_id') ?? ''),
          client_secret: String(formData.get('client_secret') ?? ''),
          source_code: String(formData.get('source_code') ?? ''),
        }),
      });

      const body = (await response.json()) as { error?: string; environment?: string };

      if (!response.ok) {
        setMessage({ tone: 'error', text: body.error ?? t.payments.failed });
        return;
      }

      setMessage({
        tone: 'ok',
        text:
          body.environment === 'production'
            ? t.payments.viva.savedProduction
            : t.payments.viva.savedDemo,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t.payments.viva.removeConfirm)) {
      return;
    }

    setBusy(true);
    try {
      await fetch('/api/settings/viva', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="space-y-4 px-5 py-4">
      <p className="text-sm leading-relaxed text-ink-600">
        {t.payments.viva.whereIntro}{' '}
        <strong className="font-semibold text-ink-900">{t.payments.viva.wherePath}</strong>
        {t.payments.viva.whereMiddle}{' '}
        <strong className="font-semibold text-ink-900">{t.payments.viva.whereEmphasis}</strong>{' '}
        {t.payments.viva.whereRest}
      </p>

      {configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={environment === 'production' ? 'positive' : 'warning'}>
            {environment === 'production' ? t.payments.viva.production : t.payments.viva.demo}
          </Badge>
          {sourceCode ? <Badge tone="neutral">Source {sourceCode}</Badge> : null}
        </div>
      ) : null}

      <Field label="Client ID" hint="…apps.vivapayments.com">
        <input
          name="client_id"
          autoComplete="off"
          required={!configured}
          placeholder={configured ? '••••••••••••' : 'xxxxx.apps.vivapayments.com'}
          className={inputClass}
        />
      </Field>

      <Field label="Client Secret">
        <input
          name="client_secret"
          type="password"
          autoComplete="off"
          required={!configured}
          placeholder={configured ? '••••••••••••' : ''}
          className={inputClass}
        />
      </Field>

      <Field
        label="Source code"
        hint={t.payments.viva.sourceHint}
      >
        <input
          name="source_code"
          autoComplete="off"
          defaultValue={sourceCode ?? ''}
          placeholder={t.payments.viva.sourcePlaceholder}
          className={inputClass}
        />
      </Field>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t.payments.saving : t.payments.save}
        </Button>
        {configured ? (
          <Button type="button" variant="secondary" onClick={remove} disabled={busy}>{t.payments.remove}</Button>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-ink-500">
        {t.payments.viva.returnIntro} <strong>{t.payments.viva.returnPage}</strong>{' '}
        {t.payments.viva.returnRest} <code className="rounded bg-ink-100 px-1 py-0.5">https://lefta.app/api/viva/return</code>
      </p>
    </form>
  );
}
