'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

/**
 * Connects the billing system.
 *
 * Both values are needed and they live in different places in Elorus, which is
 * the usual reason a first attempt fails: the API key is personal, on the user
 * profile, while the organization id is a property of the organization. Missing
 * the second produces a bare 403 that looks exactly like a permissions problem,
 * so the hints name both locations explicitly.
 */
export function ElorusForm({
  connected,
  organizationId,
}: {
  connected: boolean;
  organizationId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/elorus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: String(formData.get('organization_id') ?? ''),
          api_key: String(formData.get('api_key') ?? ''),
        }),
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'Failed.' });
        return;
      }

      setMessage({ tone: 'ok', text: t.settings.saved });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch('/api/settings/elorus', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="space-y-4 px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.settings.elorusOrgId} hint={t.settings.elorusOrgIdHint}>
          <input
            name="organization_id"
            required
            defaultValue={organizationId ?? ''}
            className={inputClass}
          />
        </Field>

        <Field label={t.settings.elorusApiKey} hint={t.settings.elorusApiKeyHint}>
          <input
            name="api_key"
            type="password"
            autoComplete="off"
            // Blank means "keep the stored key", so a tenant editing only the
            // organization id does not have to paste the secret again.
            placeholder={connected ? '••••••••••••' : ''}
            className={inputClass}
          />
        </Field>
      </div>

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
          {busy ? t.common.saving : t.common.save}
        </Button>
        {connected ? (
          <Button type="button" variant="secondary" onClick={disconnect} disabled={busy}>
            {t.common.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
