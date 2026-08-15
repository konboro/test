import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { workflowStatus } from '@/lib/dunning/status';
import { contactLimitsDisabled } from '@/lib/limits';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { markInvoicePaid } from './actions';
import { CopyPayLink, CreateInvoiceForm, RemindButton } from './invoice-forms';

export const metadata = { title: 'Παραστατικά — lefta.app' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'pending', label: 'Ανοιχτά' },
  { key: 'paid', label: 'Εξοφλημένα' },
  { key: 'all', label: 'Όλα' },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = 'pending' } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let query = supabase.from('invoices').select('*').order('due_date', { ascending: true });
  if (filter === 'pending') query = query.eq('status', 'pending');
  else if (filter === 'paid') query = query.eq('status', 'paid');

  const [{ data: invoices }, { data: debtors }, { data: contacts }] = await Promise.all([
    query.limit(500),
    supabase.from('debtors').select('id, name').order('name'),
    supabase.from('dunning_contacts').select('invoice_id, step'),
  ]);

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  const stepsByInvoice = new Map<string, Set<DunningStep>>();
  for (const c of contacts ?? []) {
    // A manual reminder has no step: it is a contact, not a rung, and must not
    // move the invoice's position on the ladder.
    if (!c.step) continue;
    const set = stepsByInvoice.get(c.invoice_id) ?? new Set<DunningStep>();
    set.add(c.step);
    stepsByInvoice.set(c.invoice_id, set);
  }

  const today = athensDate();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Παραστατικά</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Συγχρονισμένα από το myDATA ή καταχωρημένα χειροκίνητα.
          </p>
        </div>
        <CreateInvoiceForm debtors={debtors ?? []} />
      </div>

      {contactLimitsDisabled() ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Δοκιμαστική λειτουργία — το ημερήσιο όριο είναι ανενεργό.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Οι χειροκίνητες υπενθυμίσεις στέλνονται χωρίς περιορισμό και δεν καταγράφονται ως
            επαφές. Η αυτόματη ροή δεν επηρεάζεται. Αφαιρέστε το{' '}
            <code>UNSAFE_DISABLE_CONTACT_LIMITS</code> πριν σταλεί οτιδήποτε σε πραγματικό πελάτη.
          </p>
        </div>
      ) : null}

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <a
            key={f.key}
            href={`/invoices?filter=${f.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filter === f.key
                ? 'bg-ink-900 text-white'
                : 'border border-ink-300 bg-white text-ink-600 hover:bg-ink-50'
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      <Card>
        <CardHeader title={`${invoices?.length ?? 0} παραστατικά`} />

        {!invoices?.length ? (
          <EmptyState
            title="Κανένα παραστατικό"
            body="Συγχρονίστε με το myDATA από την επισκόπηση, ή καταχωρήστε ένα παραστατικό χειροκίνητα."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">Παραστατικό</th>
                  <th className="px-5 py-2.5 font-medium">Πελάτης</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ποσό</th>
                  <th className="px-5 py-2.5 font-medium">Λήξη</th>
                  <th className="px-5 py-2.5 font-medium">Κατάσταση</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ενέργειες</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const status = workflowStatus(
                    invoice,
                    stepsByInvoice.get(invoice.id) ?? new Set(),
                    today,
                  );
                  const label =
                    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
                    invoice.mark ||
                    invoice.id.slice(0, 8);

                  return (
                    <tr key={invoice.id} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium text-ink-900">{label}</div>
                        <div className="tabular mt-0.5 text-xs text-ink-500">
                          {invoice.mark ? `MARK ${invoice.mark}` : 'Χειροκίνητο'}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-ink-700">
                        {debtorsById.get(invoice.debtor_id)?.name ?? '—'}
                      </td>
                      <td className="tabular px-5 py-3 text-right font-medium text-ink-900">
                        {formatMoney(invoice.amount_cents, invoice.currency)}
                      </td>
                      <td className="tabular px-5 py-3 text-ink-600">
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {invoice.status === 'pending' ? (
                            <>
                              <RemindButton invoiceId={invoice.id} label={label} />
                              <CopyPayLink token={invoice.pay_token} />
                              <form action={markInvoicePaid}>
                                <input type="hidden" name="id" value={invoice.id} />
                                <button
                                  type="submit"
                                  className="text-sm font-medium text-ink-500 hover:text-ink-800 hover:underline"
                                  title="Καταχώρηση εξόφλησης εκτός πλατφόρμας (π.χ. τραπεζικό έμβασμα)"
                                >
                                  Εξοφλήθηκε
                                </button>
                              </form>
                            </>
                          ) : invoice.paid_at ? (
                            <span className="tabular text-xs text-ink-500">
                              {formatDate(invoice.paid_at.slice(0, 10))}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
