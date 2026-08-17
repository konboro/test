'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

import { syncBankNow, type BankSyncState } from './bank-actions';

/**
 * Runs the feed on demand and reports what came back.
 *
 * The counts are deliberately shown rather than reduced to "done": while a
 * connection is being set up the useful question is not whether the call
 * succeeded but where an empty result came from. `fetched` is what the bank
 * returned, `credits` what survived as incoming money, `new` what was not
 * already stored. Zero fetched means the account or the window is empty; rows
 * fetched but no credits means everything was outgoing — or that the fields do
 * not match what the parser expects, which is worth knowing on day one rather
 * than after a month of silence.
 */
export function BankSyncButton() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<BankSyncState | null>(null);

  async function run() {
    setBusy(true);
    setState(null);
    try {
      setState(await syncBankNow());
    } finally {
      setBusy(false);
    }
  }

  const r = state?.result;

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" onClick={run} disabled={busy}>
        {busy ? 'Ανάγνωση…' : 'Ανάγνωση κινήσεων τώρα'}
      </Button>

      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {state.error}
        </p>
      ) : null}

      {r ? (
        <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-700">
          <p className="tabular">
            Λογαριασμοί: {r.connectionsChecked} · Κινήσεις από την τράπεζα: {r.fetched} · Εισπράξεις:{' '}
            {r.creditsSeen} · Νέες: {r.creditsNew} · Εξοφλήθηκαν: {r.settled} · Προς έλεγχο:{' '}
            {r.queued}
          </p>

          {r.connectionsChecked === 0 ? (
            <p className="mt-1 text-ink-500">
              Κανένας ενεργός λογαριασμός. Συνδέστε τράπεζα ή ανανεώστε ληγμένη άδεια.
            </p>
          ) : r.fetched === 0 ? (
            <p className="mt-1 text-ink-500">
              Η τράπεζα δεν επέστρεψε καμία κίνηση για το διάστημα που ζητήθηκε.
            </p>
          ) : r.creditsSeen === 0 ? (
            <p className="mt-1 text-ink-500">
              Επιστράφηκαν κινήσεις, αλλά καμία εισερχόμενη — μόνο χρεώσεις στο διάστημα αυτό.
            </p>
          ) : null}

          {r.expired.length ? (
            <p className="mt-1 text-amber-700">
              Έληξε η άδεια πρόσβασης σε {r.expired.length} λογαριασμό/ούς.
            </p>
          ) : null}

          {r.errors.length ? (
            <ul className="mt-1 space-y-0.5 text-red-700">
              {r.errors.map((e) => (
                <li key={`${e.connectionId}:${e.error}`}>{e.error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
