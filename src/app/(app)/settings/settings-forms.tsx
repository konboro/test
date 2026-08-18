'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import type { SMS_PACKS } from '@/lib/stripe';

import { updateProfile, type SettingsState } from './actions';
import { useT } from '@/lib/i18n/provider';

function Submit({ label }: { label?: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.fields.saving : (label ?? t.fields.save)}
    </Button>
  );
}

export function ProfileForm({
  profile,
}: {
  profile: {
    company_name: string | null;
    vat_number: string | null;
    reply_to_email: string | null;
    automation_enabled: boolean;
  };
}) {
  const t = useT();
  const [state, action] = useActionState<SettingsState, FormData>(updateProfile, {});

  return (
    <form action={action} className="space-y-4 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.fields.companyName}>
          <input
            name="company_name"
            required
            defaultValue={profile.company_name ?? ''}
            className={inputClass}
          />
        </Field>

        <Field label={t.fields.vat}>
          <input name="vat_number" defaultValue={profile.vat_number ?? ''} className={inputClass} />
        </Field>

        <Field
          label={t.fields.replyTo}
          hint={t.fields.replyToHint}
        >
          <input
            name="reply_to_email"
            type="email"
            defaultValue={profile.reply_to_email ?? ''}
            className={inputClass}
          />
        </Field>

      </div>

      <label className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
        <input
          name="automation_enabled"
          type="checkbox"
          defaultChecked={profile.automation_enabled}
          className="mt-0.5 h-4 w-4 rounded border-ink-300"
        />
        <span>
          <span className="block text-sm font-medium text-ink-900">
            {t.fields.automationOn}
          </span>
          <span className="block text-xs text-ink-500">
            {t.fields.automationHint}
          </span>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}

export function MyDataForm({
  connected,
  userId,
  environment,
}: {
  connected: boolean;
  userId: string | null;
  environment: 'production' | 'sandbox';
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/mydata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mydata_user_id: String(form.get('mydata_user_id') ?? ''),
          subscription_key: String(form.get('subscription_key') ?? ''),
          environment: String(form.get('environment') ?? 'production'),
          // Round-trip against AADE before saving, so a typo is caught here
          // rather than at 07:00 during the nightly sweep.
          verify: true,
        }),
      });

      const body = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !body.ok) {
        setMessage({ tone: 'error', text: body.error ?? t.fields.saveFailed });
        return;
      }

      setMessage({ tone: 'ok', text: t.fields.credentialsVerified });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t.fields.deleteMydataConfirm)) return;

    setBusy(true);
    await fetch('/api/settings/mydata', { method: 'DELETE' });
    setBusy(false);
    setMessage({ tone: 'ok', text: t.fields.mydataDisconnected });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="myDATA User ID">
          <input
            name="mydata_user_id"
            required
            defaultValue={userId ?? ''}
            className={inputClass}
            autoComplete="off"
          />
        </Field>

        <Field label={t.fields.environment}>
          <select name="environment" defaultValue={environment} className={inputClass}>
            <option value="production">{t.fields.envProduction}</option>
            <option value="sandbox">{t.fields.envSandbox}</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Subscription Key"
            hint={
              connected
                ? t.fields.keyStored
                : t.fields.keyFromAccount
            }
          >
            <input
              name="subscription_key"
              type="password"
              placeholder={connected ? '••••••••••••' : ''}
              className={inputClass}
              autoComplete="off"
            />
          </Field>
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t.fields.verifying : t.fields.verifyAndSave}
        </Button>
        {connected ? (
          <Button type="button" variant="secondary" onClick={disconnect} disabled={busy}>
            {t.fields.disconnect}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function CreditPacks({ packs }: { packs: typeof SMS_PACKS }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(packId: string) {
    setBusy(packId);
    setError(null);

    try {
      const response = await fetch('/api/stripe/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: packId }),
      });

      const body = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !body.url) {
        setError(body.error ?? t.fields.checkoutFailed);
        return;
      }

      window.location.href = body.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  }

  return (
    <div className="px-5 py-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {packs.map((pack) => (
          <div key={pack.id} className="rounded-lg border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900">{pack.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-ink-900">
              {(pack.amountCents / 100).toFixed(2)} €
            </p>
            <p className="tabular mt-0.5 text-xs text-ink-500">
              {((pack.amountCents / pack.credits) / 100).toFixed(3)} € / SMS
            </p>
            <Button
              onClick={() => buy(pack.id)}
              disabled={busy !== null}
              className="mt-3 w-full"
              variant="secondary"
            >
              {busy === pack.id ? t.fields.redirecting : t.fields.buy}
            </Button>
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
