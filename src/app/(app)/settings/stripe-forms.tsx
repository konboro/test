'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

/**
 * Links the tenant's own Stripe account.
 *
 * The wording matters as much as the mechanism here: tenants need to understand
 * that the money goes to them, not through lefta, because that is the whole
 * reason the integration is shaped this way.
 */
/**
 * The tenant's own Stripe key.
 *
 * Deliberately a stopgap, and the copy says so: once lefta has a Stripe account
 * of its own, Connect replaces this and nobody has to hand over a secret key.
 */
function OwnKeyForm({ hasKey }: { hasKey: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/stripe-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_key: String(formData.get('secret_key') ?? '') }),
      });

      const body = (await response.json()) as { error?: string; testMode?: boolean };

      if (!response.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'Failed.' });
        return;
      }

      setMessage({
        tone: 'ok',
        text: body.testMode
          ? t.payments.stripe.keySavedTest
          : t.payments.stripe.keySaved,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/settings/stripe-key', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="space-y-4 px-5 py-4">
      <p className="text-sm leading-relaxed text-ink-600">
        {t.payments.stripe.pasteIntro}{' '}
        <strong className="font-semibold text-ink-900">{t.payments.stripe.pasteKeyName}</strong>{' '}
        {t.payments.stripe.pasteRest}
      </p>

      <Field label="Stripe Secret key" hint={t.payments.stripe.keyHint}>
        <input
          name="secret_key"
          type="password"
          autoComplete="off"
          required={!hasKey}
          placeholder={hasKey ? '••••••••••••' : 'sk_test_…'}
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
        {hasKey ? (
          <Button type="button" variant="secondary" onClick={remove} disabled={busy}>{t.payments.remove}</Button>
        ) : null}
      </div>
    </form>
  );
}

export function StripeConnect({
  accountId,
  chargesEnabled,
  available,
  hasOwnKey,
}: {
  accountId: string | null;
  chargesEnabled: boolean;
  /** False when the platform has no Connect client id configured. */
  available: boolean;
  /** Whether the tenant has pasted their own key as a stopgap. */
  hasOwnKey: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!window.confirm(t.payments.stripe.disconnectConfirm)) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/stripe/connect/disconnect', { method: 'POST' });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? t.payments.stripe.disconnectFailed);
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!accountId && !available) {
    // No platform to run Connect from yet, so the tenant supplies their own key
    // and charges are created directly on their account with it. Same outcome —
    // the money is theirs and never passes through lefta.
    return <OwnKeyForm hasKey={hasOwnKey} />;
  }

  if (!accountId) {
    return (
      <div className="px-5 py-4">
        <p className="text-sm leading-relaxed text-ink-600">
          {t.payments.stripe.connectIntro}{' '}
          <strong className="font-semibold text-ink-900">{t.payments.stripe.connectEmphasis}</strong>
          {t.payments.stripe.connectRest}
        </p>

        {/* A plain anchor, not a Button: the handshake starts with a full-page
            redirect to Stripe, so this must be a real navigation.

            The lint rule wants `<Link>` because the root-level `[code]` route
            makes every path look like a page to it. This one is an API route
            that answers with a redirect off-site — client-side navigation would
            simply fail. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/stripe/connect/start"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >{t.payments.stripe.connectCta}</a>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-500">{t.payments.account}</dt>
          <dd className="tabular font-medium text-ink-900">{accountId}</dd>
        </div>
      </dl>

      {!chargesEnabled ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {t.payments.stripe.pendingReview}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-ink-500">
          {t.payments.stripe.liveNote}
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="button" variant="secondary" onClick={disconnect} disabled={busy}>
        {busy ? t.payments.disconnecting : t.payments.disconnect}
      </Button>
    </div>
  );
}
