'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui';

/**
 * Links the tenant's own Stripe account.
 *
 * The wording matters as much as the mechanism here: tenants need to understand
 * that the money goes to them, not through lefta, because that is the whole
 * reason the integration is shaped this way.
 */
export function StripeConnect({
  accountId,
  chargesEnabled,
  available,
}: {
  accountId: string | null;
  chargesEnabled: boolean;
  /** False when the platform has no Connect client id configured. */
  available: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!window.confirm('Αποσύνδεση του λογαριασμού Stripe; Οι πελάτες σας δεν θα μπορούν να πληρώνουν με κάρτα.')) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/stripe/connect/disconnect', { method: 'POST' });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? 'Δεν ήταν δυνατή η αποσύνδεση.');
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!accountId && !available) {
    // Better an explicit state than a button that redirects into a 500 because
    // the platform has no Connect client id.
    return (
      <p className="px-5 py-4 text-sm leading-relaxed text-ink-600">
        Η σύνδεση με Stripe δεν είναι ακόμη διαθέσιμη σε αυτή την εγκατάσταση. Επικοινωνήστε με τον
        διαχειριστή της πλατφόρμας.
      </p>
    );
  }

  if (!accountId) {
    return (
      <div className="px-5 py-4">
        <p className="text-sm leading-relaxed text-ink-600">
          Συνδέστε τον δικό σας λογαριασμό Stripe για να δέχεστε πληρωμές με κάρτα. Τα χρήματα
          πηγαίνουν <strong className="font-semibold text-ink-900">απευθείας σε εσάς</strong>· το
          lefta.app δεν μεσολαβεί στη ροή χρημάτων και δεν κρατά κανένα ποσό.
        </p>

        {/* A plain anchor, not a Button: the handshake starts with a full-page
            redirect to Stripe, so this must be a real navigation. */}
        <a
          href="/api/stripe/connect/start"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Σύνδεση με Stripe
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-500">Λογαριασμός</dt>
          <dd className="tabular font-medium text-ink-900">{accountId}</dd>
        </div>
      </dl>

      {!chargesEnabled ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          Ο λογαριασμός συνδέθηκε, αλλά το Stripe δεν έχει ολοκληρώσει ακόμη τον έλεγχο των
          στοιχείων σας. Μέχρι τότε το κουμπί πληρωμής δεν εμφανίζεται στους πελάτες σας.
          Ολοκληρώστε τα στοιχεία στο Stripe και η κατάσταση ενημερώνεται αυτόματα.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-ink-500">
          Οι πληρωμές χρεώνονται απευθείας στον λογαριασμό σας. Το lefta.app δεν λαμβάνει προμήθεια
          και δεν εμφανίζεται στη συναλλαγή.
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="button" variant="secondary" onClick={disconnect} disabled={busy}>
        {busy ? 'Αποσύνδεση…' : 'Αποσύνδεση'}
      </Button>
    </div>
  );
}
