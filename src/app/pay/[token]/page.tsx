import { notFound } from 'next/navigation';

import { formatDate, formatMoney } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

import { PayButton } from './pay-button';

export const metadata = { title: 'Εξόφληση παραστατικού' };
export const dynamic = 'force-dynamic';

/**
 * Public payment page for the debtor.
 *
 * Reached from a reminder link. The opaque `pay_token` is the only credential,
 * and the page deliberately shows the minimum needed to recognise and settle the
 * document — no debtor list, no tenant data, no other invoices.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token } = await params;
  const { paid } = await searchParams;

  // `get_invoice_for_payment` is a security-definer function exposing exactly
  // these columns, so the invoices table itself stays closed to anonymous reads.
  const { data, error } = await createAdminClient().rpc('get_invoice_for_payment', {
    p_token: token,
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
          <div className="border-b border-ink-200 bg-linear-to-b from-brand-50 to-white px-6 py-7 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
              Οφειλόμενο ποσό
            </p>
            <p className="tabular mt-1.5 text-4xl font-semibold tracking-tight text-ink-900">
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
            {settled || paid === '1' ? (
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
            ) : payable && invoice.payments_enabled ? (
              <>
                <PayButton token={token} />
                <p className="mt-3 text-center text-xs text-ink-500">
                  Ασφαλής πληρωμή με κάρτα μέσω Stripe. Το lefta.app δεν αποθηκεύει στοιχεία κάρτας.
                </p>
              </>
            ) : payable ? (
              // Either the platform has no Stripe key, or this creditor has not
              // connected their own account yet. The document details above are
              // still worth showing — a reminder link must never dead-end on a
              // button that fails the moment it is pressed.
              <div className="rounded-lg bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                Η ηλεκτρονική πληρωμή δεν είναι προς το παρόν διαθέσιμη. Επικοινωνήστε με τον εκδότη
                για την εξόφληση.
              </div>
            ) : (
              <div className="rounded-lg bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                Το παραστατικό δεν είναι διαθέσιμο για ηλεκτρονική πληρωμή. Επικοινωνήστε με τον
                εκδότη.
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Η σελίδα παρέχεται από την πλατφόρμα{' '}
          <span className="font-semibold text-ink-700">
            lefta<span className="text-brand-500">.app</span>
          </span>{' '}
          για λογαριασμό της {invoice.creditor_name}. Για ερωτήματα σχετικά με το παραστατικό,
          απευθυνθείτε απευθείας στον εκδότη.
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
