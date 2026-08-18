import type { Aspsp } from '@/lib/bank/client';
import type { Dictionary } from '@/lib/i18n';
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
  t,
}: {
  banks: Aspsp[];
  connections: BankConnectionRow[];
  t: Dictionary;
}) {
  const active = connections.filter((c) => c.status === 'active');
  const expired = connections.filter((c) => c.status === 'expired');
  const copy = t.bank.card;

  return (
    <div className="space-y-4 px-5 py-4">
      {active.length ? (
        <>
          <dl className="space-y-2 text-sm">
            {active.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between gap-4">
                <dt className="text-ink-700">{connection.institution_name}</dt>
                <dd className="text-xs text-ink-500">
                  {[
                    connection.last_synced_at
                      ? copy.lastCheck(formatDate(connection.last_synced_at.slice(0, 10)))
                      : null,
                    // What that read actually returned. An empty table with no
                    // number beside it is the state nobody can act on.
                    connection.last_fetched_count !== null
                      ? copy.counts(
                          connection.last_fetched_count,
                          connection.last_credit_count ?? 0,
                        )
                      : null,
                    connection.consent_expires_at
                      ? copy.accessUntil(formatDate(connection.consent_expires_at.slice(0, 10)))
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
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
              {copy.checkNow}
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-ink-600">
          {copy.pitch}{' '}
          <span className="font-medium text-ink-800">{copy.pitchReadOnly}</span>
        </p>
      )}

      {expired.length ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {copy.expired}
        </p>
      ) : null}

      {banks.length ? (
        <form action="/api/bank/connect/start" method="get" className="flex flex-wrap gap-2">
          <input type="hidden" name="country" value="GR" />
          <label className="sr-only" htmlFor="aspsp">
            {copy.bankLabel}
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
            {active.length ? copy.connectAnother : copy.connect}
          </button>
        </form>
      ) : (
        <p className="text-xs text-ink-500">{copy.unavailable}</p>
      )}
    </div>
  );
}
