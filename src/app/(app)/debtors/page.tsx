import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, subtleLinkClass } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { toggleMute } from './actions';
import { CreateDebtorForm, EditDebtorForm } from './debtor-forms';

export const metadata = { title: 'Πελάτες' };
export const dynamic = 'force-dynamic';

export default async function DebtorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: debtors }, { data: invoices }] = await Promise.all([
    supabase.from('debtors').select('*').order('name'),
    supabase.from('invoices').select('debtor_id, amount_cents, status').eq('status', 'pending'),
  ]);

  const outstanding = new Map<string, { count: number; total: number }>();
  for (const invoice of invoices ?? []) {
    const current = outstanding.get(invoice.debtor_id) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += invoice.amount_cents;
    outstanding.set(invoice.debtor_id, current);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Πελάτες</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Οι πελάτες δημιουργούνται αυτόματα από το myDATA. Συμπληρώστε email και κινητό ώστε να
            μπορούν να λαμβάνουν υπενθυμίσεις.
          </p>
        </div>
        <CreateDebtorForm />
      </div>

      <Card>
        <CardHeader title={`${debtors?.length ?? 0} πελάτες`} />

        {!debtors?.length ? (
          <EmptyState
            title="Κανένας πελάτης ακόμη"
            body="Συγχρονίστε τα παραστατικά σας από το myDATA ή προσθέστε έναν πελάτη χειροκίνητα."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {debtors.map((debtor) => {
              const open = outstanding.get(debtor.id);
              const reachable = Boolean(debtor.email || debtor.phone);

              return (
                <li key={debtor.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">{debtor.name}</span>
                        {debtor.vat_number ? (
                          <span className="tabular text-xs text-ink-500">ΑΦΜ {debtor.vat_number}</span>
                        ) : null}
                        {debtor.muted ? <Badge tone="neutral">σε παύση</Badge> : null}
                        {!reachable ? <Badge tone="danger">χωρίς στοιχεία επικοινωνίας</Badge> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
                        <span>{debtor.email ?? '— χωρίς email'}</span>
                        <span className="tabular">{debtor.phone ?? '— χωρίς τηλέφωνο'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="tabular text-sm font-semibold text-ink-900">
                          {formatMoney(open?.total ?? 0)}
                        </p>
                        <p className="text-xs text-ink-500">{open?.count ?? 0} ανοιχτά</p>
                      </div>

                      <EditDebtorForm debtor={debtor} />

                      <form action={toggleMute}>
                        <input type="hidden" name="id" value={debtor.id} />
                        <input type="hidden" name="muted" value={String(debtor.muted)} />
                        <button
                          type="submit"
                          className={`text-sm ${subtleLinkClass}`}
                        >
                          {debtor.muted ? 'Ενεργοποίηση' : 'Παύση'}
                        </button>
                      </form>
                    </div>
                  </div>

                  {debtor.notes ? (
                    <p className="mt-2 text-sm text-ink-500">{debtor.notes}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
