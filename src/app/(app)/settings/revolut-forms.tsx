'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

/**
 * The tenant's own Revolut Merchant API key.
 *
 * Same arrangement as the Stripe key and the Viva credentials, and the copy
 * says so: the money lands on their Revolut account and lefta never appears in
 * the payment. One field, because that is all Revolut needs — the estate is
 * detected from the key itself.
 */
export function RevolutForm({
  configured,
  environment,
}: {
  configured: boolean;
  environment: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/revolut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_key: String(formData.get('secret_key') ?? '') }),
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
            ? t.payments.revolut.savedProduction
            : t.payments.revolut.savedSandbox,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t.payments.revolut.removeConfirm)) return;

    setBusy(true);
    try {
      await fetch('/api/settings/revolut', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="space-y-4 px-5 py-4">
      <p className="text-sm leading-relaxed text-ink-600">
        {t.payments.revolut.whereIntro}{' '}
        <strong className="font-semibold text-ink-900">{t.payments.revolut.wherePath}</strong>
        {t.payments.revolut.whereMiddle}{' '}
        <strong className="font-semibold text-ink-900">{t.payments.revolut.whereEmphasis}</strong>{' '}
        {t.payments.revolut.whereRest}
      </p>

      {configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={environment === 'production' ? 'positive' : 'warning'}>
            {environment === 'production'
              ? t.payments.revolut.production
              : t.payments.revolut.sandbox}
          </Badge>
        </div>
      ) : null}

      <Field label={t.payments.revolut.keyLabel} hint={t.payments.revolut.keyHint}>
        <input
          name="secret_key"
          type="password"
          autoComplete="off"
          required={!configured}
          placeholder={configured ? '••••••••••••' : 'sk_…'}
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
          <Button type="button" variant="secondary" onClick={remove} disabled={busy}>
            {t.payments.remove}
          </Button>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-ink-500">{t.payments.revolut.returnNote}</p>
    </form>
  );
}
