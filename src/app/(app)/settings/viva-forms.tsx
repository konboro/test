'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, Button, Field, inputClass } from '@/components/ui';

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
        setMessage({ tone: 'error', text: body.error ?? 'Αποτυχία.' });
        return;
      }

      setMessage({
        tone: 'ok',
        text:
          body.environment === 'production'
            ? 'Τα στοιχεία αποθηκεύτηκαν. Λογαριασμός παραγωγής — οι πληρωμές είναι πραγματικές.'
            : 'Τα στοιχεία αποθηκεύτηκαν. Λογαριασμός demo — οι πληρωμές δεν είναι πραγματικές.',
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Αφαίρεση των στοιχείων Viva; Οι πελάτες σας δεν θα μπορούν να πληρώνουν με κάρτα μέσω Viva.')) {
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
        Στο Viva: <strong className="font-semibold text-ink-900">Settings → API Access →
        Smart Checkout Credentials</strong>. Οι πληρωμές εισπράττονται{' '}
        <strong className="font-semibold text-ink-900">απευθείας στον λογαριασμό σας</strong> — το
        lefta.app δεν μεσολαβεί στη ροή χρημάτων.
      </p>

      {configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={environment === 'production' ? 'positive' : 'warning'}>
            {environment === 'production' ? 'Παραγωγή' : 'Demo'}
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
        hint="Προαιρετικό — αφήστε το κενό για την προεπιλεγμένη πηγή πληρωμών του λογαριασμού."
      >
        <input
          name="source_code"
          autoComplete="off"
          defaultValue={sourceCode ?? ''}
          placeholder="π.χ. 1234"
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
          {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
        {configured ? (
          <Button type="button" variant="secondary" onClick={remove} disabled={busy}>
            Αφαίρεση
          </Button>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-ink-500">
        Στη σελίδα <strong>API Access</strong> ορίστε ως διεύθυνση επιτυχίας και αποτυχίας της πηγής
        πληρωμών: <code className="rounded bg-ink-100 px-1 py-0.5">https://lefta.app/api/viva/return</code>
      </p>
    </form>
  );
}
