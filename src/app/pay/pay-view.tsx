import { notFound } from 'next/navigation';

import { formatDate, formatMoney } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

import { PayButton } from './pay-button';

/**
 * Public payment page for the debtor.
 *
 * Rendered by both entry points — the short `lefta.app/<code>` link and the
 * long `/pay/<token>` one that older reminders carry. The credential is the only
 * thing the visitor holds, and the page deliberately shows the minimum needed to
 * recognise and settle the document — no debtor list, no tenant data, no other
 * invoices.
 */
export async function PayView({ credential, paid }: { credential: string; paid: boolean }) {
  // `get_invoice_for_payment` is a security-definer function exposing exactly
  // these columns, so the invoices table itself stays closed to anonymous reads.
  // It matches either credential, which is what keeps old links alive.
  const { data, error } = await createAdminClient().rpc('get_invoice_for_payment', {
    p_token: credential,
  });

  const invoice = data?.[0];
  if (error || !invoice) notFound();

  const settled = invoice.status === 'paid';
  const payable = invoice.status === 'pending';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="text-center text-sm text-ink-500">
          Εξόφληση προς <span className="font-medium text-ink-800">{invoice.creditor_name}</span>
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
          <div className="border-b border-ink-200 px-6 py-6 text-center">
            <p className="text-xs uppercase tracking-wide text-ink-500">Οφειλόμενο ποσό</p>
            <p className="tabular mt-1 text-4xl font-semibold text-ink-900">
              {formatMoney(invoice.amount_cents, invoice.currency)}
            </p>
          </div>

          <dl className="divide-y divide-ink-100 text-sm">
            <Row label="Παραστατικό" value={invoice.invoice_number ?? '—'} />
            <Row label="Επωνυμία" value={invoice.debtor_name} />
            <Row label="Ημ. έκδοσης" value={formatDate(invoice.issue_date)} />
            <Row label="Ημ. λήξης" value={formatDate(invoice.due_date)} />
          </dl>

          <div className="border-t border-ink-200 px-6 py-6">
            {settled || paid ? (
              <div className="rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-800">
                {settled ? (
                  <>
                    <p className="font-medium">Το παραστατικό έχει εξοφληθεί.</p>
                    <p className="mt-1 text-xs">Ευχαριστούμε.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Η πληρωμή σας καταχωρείται.</p>
                    <p className="mt-1 text-xs">
                      Η επιβεβαίωση ολοκληρώνεται σε λίγα δευτερόλεπτα. Μπορείτε να κλείσετε αυτή τη
                      σελίδα.
                    </p>
                  </>
                )}
              </div>
            ) : payable ? (
              <>
                <PayButton token={credential} />
                <p className="mt-3 text-center text-xs text-ink-500">
                  Ασφαλής πληρωμή με κάρτα μέσω Stripe. Το lefta.app δεν αποθηκεύει στοιχεία κάρτας.
                </p>
              </>
            ) : (
              <div className="rounded-lg bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                Το παραστατικό δεν είναι διαθέσιμο για ηλεκτρονική πληρωμή. Επικοινωνήστε με τον
                εκδότη.
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Η σελίδα παρέχεται από την πλατφόρμα lefta.app για λογαριασμό της{' '}
          {invoice.creditor_name}. Για ερωτήματα σχετικά με το παραστατικό, απευθυνθείτε απευθείας
          στον εκδότη.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
