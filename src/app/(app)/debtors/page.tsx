import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, subtleLinkClass } from '@/components/ui';
import { displayName } from '@/lib/debtors';
import { getDictionary } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { toggleMute } from './actions';
import { CreateDebtorForm, EditDebtorForm } from './debtor-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).debtors.title };
}
export const dynamic = 'force-dynamic';

/**
 * One labelled field.
 *
 * The list used to run name, VAT, email and phone together as bare text, which
 * is unreadable once a customer is missing half of them — a lone phone number
 * and a lone VAT number look the same. A label above each value, and a visible
 * dash where there is nothing, makes it obvious what is present and what still
 * needs filling in.
 */
function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd
        className={`truncate text-sm ${value ? 'text-ink-800' : 'text-ink-400'} ${mono ? 'tabular' : ''}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

export default async function DebtorsPage() {
  const t = await getDictionary();
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
          <h1 className="text-xl font-semibold text-ink-900">{t.debtors.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {t.debtors.subtitle}
          </p>
        </div>
        <CreateDebtorForm />
      </div>

      <Card>
        <CardHeader title={t.debtors.count(debtors?.length ?? 0)} />

        {!debtors?.length ? (
          <EmptyState
            title={t.debtors.emptyTitle}
            body={t.debtors.emptyBody}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {debtors.map((debtor) => {
              const open = outstanding.get(debtor.id);
              const reachable = Boolean(debtor.email || debtor.phone);
              const name = displayName(debtor);

              return (
                <li key={debtor.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/debtors/${debtor.id}`}
                          className="font-medium underline-offset-2 transition hover:text-brand-600 hover:underline"
                        >
                          {name ? (
                            <span className="text-ink-900">{name}</span>
                          ) : (
                            // Imported customers usually arrive nameless. Saying
                            // so beats showing "ΑΦΜ 123456789" in the name slot,
                            // right beside the identical VAT number.
                            <span className="italic text-ink-400">{t.debtors.nameMissing}</span>
                          )}
                        </Link>
                        {debtor.muted ? <Badge tone="neutral">{t.debtors.muted}</Badge> : null}
                        {!reachable ? <Badge tone="danger">{t.debtors.noContact}</Badge> : null}
                      </div>

                      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                        <Detail label={t.debtors.vat} value={debtor.vat_number} mono />
                        <Detail label={t.debtors.emailLabel} value={debtor.email} />
                        <Detail label={t.debtors.phoneLabel} value={debtor.phone} mono />
                      </dl>

                      {!name ? (
                        <p className="mt-2 text-xs text-amber-700">{t.debtors.nameMissingHint}</p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-ink-400">
                          {t.debtors.outstandingLabel}
                        </p>
                        <p className="tabular mt-0.5 text-sm font-semibold text-ink-900">
                          {formatMoney(open?.total ?? 0)}
                        </p>
                        <p className="text-xs text-ink-500">{t.debtors.openCount(open?.count ?? 0)}</p>
                      </div>

                      <EditDebtorForm debtor={debtor} />

                      <form action={toggleMute}>
                        <input type="hidden" name="id" value={debtor.id} />
                        <input type="hidden" name="muted" value={String(debtor.muted)} />
                        <button
                          type="submit"
                          className={`text-sm ${subtleLinkClass}`}
                        >
                          {debtor.muted ? t.debtors.unmute : t.debtors.mute}
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
