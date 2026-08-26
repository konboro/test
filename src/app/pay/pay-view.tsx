import { notFound } from 'next/navigation';

import { LeftaLogo, LeftaWordmark } from '@/components/logo';
import { formatDate, formatMoney } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

import { FunnelBeacon } from './beacon';
import { PayButton } from './pay-button';
import { ReportLinks } from './report-links';

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
      <FunnelBeacon credential={credential} />
      <div className="w-full max-w-md">
        {/* The mark, not just the word. This is the most-branded surface the
            product has — a debtor arriving from an email needs to recognise
            where they landed before they read anything else. */}
        <div className="flex justify-center">
          <LeftaLogo />
        </div>
        <p className="mt-3 text-center text-sm text-ink-500">
          Εξόφληση προς <span className="font-medium text-ink-800">{invoice.creditor_name}</span>
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lg shadow-ink-900/5">
          {/* The money-path accent: the same brand blue as the button in the
              reminder email, so the page reads as the message's continuation. */}
          <div aria-hidden="true" className="h-1 bg-brand-600" />

          <div className="border-b border-ink-200 px-6 pb-6 pt-7 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Οφειλόμενο ποσό
            </p>
            <p className="mt-2 text-5xl font-semibold leading-none tracking-tight text-ink-900">
              {formatMoney(invoice.amount_cents, invoice.currency)}
            </p>
          </div>

          <dl className="divide-y divide-ink-100 text-sm">
            <Row label="Παραστατικό" value={invoice.invoice_number ?? '—'} />
            <Row label="Επωνυμία" value={invoice.debtor_name} />
            <Row label="Ημ. έκδοσης" value={formatDate(invoice.issue_date)} />
            <Row label="Ημ. λήξης" value={formatDate(invoice.due_date)} />
          </dl>

          <div className="border-t border-ink-200 bg-ink-50/50 px-6 py-6">
            {settled || paid ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <CheckIcon />
                {settled ? (
                  <>
                    <p className="mt-2 font-medium">Το παραστατικό έχει εξοφληθεί.</p>
                    <p className="mt-1 text-xs">Ευχαριστούμε.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 font-medium">Η πληρωμή σας καταχωρείται.</p>
                    <p className="mt-1 text-xs">
                      Η επιβεβαίωση ολοκληρώνεται σε λίγα δευτερόλεπτα. Μπορείτε να κλείσετε αυτή τη
                      σελίδα.
                    </p>
                  </>
                )}
              </div>
            ) : payable && invoice.payments_enabled ? (
              <>
                <PayButton token={credential} />
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-ink-500">
                  <LockIcon />
                  Ασφαλής πληρωμή με κάρτα. Το lefta.app δεν αποθηκεύει στοιχεία κάρτας.
                </p>
                {/* The exits for whoever is NOT paying right now: already paid
                    by transfer, or the document is wrong. Both used to be dead
                    ends that earned the visitor another reminder. */}
                <ReportLinks token={credential} />
              </>
            ) : payable ? (
              // The creditor has neither a connected account nor their own key.
              // The document details above still stand — a reminder link must
              // never dead-end on a button that breaks when pressed. The report
              // links matter even more here: with no button at all, "I paid by
              // transfer" is the page's most likely true story.
              <>
                <div className="rounded-xl bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                  Η ηλεκτρονική πληρωμή δεν είναι προς το παρόν διαθέσιμη. Επικοινωνήστε με τον
                  εκδότη για την εξόφληση.
                </div>
                <ReportLinks token={credential} />
              </>
            ) : (
              <div className="rounded-xl bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                Το παραστατικό δεν είναι διαθέσιμο για ηλεκτρονική πληρωμή. Επικοινωνήστε με τον
                εκδότη.
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Η σελίδα παρέχεται από την πλατφόρμα{' '}
          <LeftaWordmark className="text-ink-700" />{' '}
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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mx-auto h-6 w-6 text-emerald-600"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 12.3l2.6 2.7L16 9.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
