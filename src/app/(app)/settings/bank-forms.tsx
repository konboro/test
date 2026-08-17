import type { Aspsp } from '@/lib/bank/client';
import { formatDate } from '@/lib/money';
import type { BankConnectionRow } from '@/types/database';

import { syncBankNow } from './bank-actions';

/**
 * Linking a bank account so transfers settle themselves.
 *
 * No client component: starting the handshake is a full-page navigation to the
 * bank, so a plain GET form does exactly the right thing and nothing is
 * interactive until the creditor is back.
 */
export function BankConnect({
  banks,
  connections,
}: {
  banks: Aspsp[];
  connections: BankConnectionRow[];
}) {
  const active = connections.filter((c) => c.status === 'active');
  const expired = connections.filter((c) => c.status === 'expired');

  return (
    <div className="space-y-4 px-5 py-4">
      {active.length ? (
        <>
          <dl className="space-y-2 text-sm">
            {active.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between gap-4">
                <dt className="text-ink-700">{connection.institution_name}</dt>
                <dd className="text-xs text-ink-500">
                  {connection.last_synced_at
                    ? `Τελευταίος έλεγχος ${formatDate(connection.last_synced_at.slice(0, 10))} · `
                    : ''}
                  {connection.consent_expires_at
                    ? `πρόσβαση έως ${formatDate(connection.consent_expires_at.slice(0, 10))}`
                    : '—'}
                </dd>
              </div>
            ))}
          </dl>

          {/* The scheduled read happens once a day inside the dunning sweep.
              This is for the moment someone is waiting for an answer. */}
          <form action={syncBankNow}>
            <button
              type="submit"
              className="rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium text-ink-700 outline-none transition hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Έλεγχος τώρα
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-ink-600">
          Συνδέστε τον τραπεζικό σας λογαριασμό και οι εξοφλήσεις με έμβασμα εντοπίζονται
          αυτόματα, ώστε οι υπενθυμίσεις να σταματούν χωρίς να χρειάζεται να τις καταχωρήσετε.{' '}
          <span className="font-medium text-ink-800">
            Η πρόσβαση είναι μόνο για ανάγνωση κινήσεων· δεν είναι δυνατή καμία πληρωμή.
          </span>
        </p>
      )}

      {expired.length ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          Η άδεια πρόσβασης έληξε. Οι τράπεζες την περιορίζουν χρονικά και πρέπει να ανανεωθεί,
          διαφορετικά οι εξοφλήσεις με έμβασμα δεν εντοπίζονται.
        </p>
      ) : null}

      {banks.length ? (
        <form action="/api/bank/connect/start" method="get" className="flex flex-wrap gap-2">
          <input type="hidden" name="country" value="GR" />
          <label className="sr-only" htmlFor="aspsp">
            Τράπεζα
          </label>
          <select
            id="aspsp"
            name="aspsp"
            className="min-w-48 flex-1 rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {banks.map((bank) => (
              <option key={bank.name} value={bank.name}>
                {bank.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            {active.length ? 'Σύνδεση άλλου λογαριασμού' : 'Σύνδεση τράπεζας'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-ink-500">
          Η υπηρεσία τραπεζικής σύνδεσης δεν είναι διαθέσιμη αυτή τη στιγμή.
        </p>
      )}
    </div>
  );
}
