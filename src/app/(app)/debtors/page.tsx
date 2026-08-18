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

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; show?: string }>;
}) {
  const { q = '', sort = 'name', dir = 'asc', show = 'all' } = await searchParams;
  const descending = dir === 'desc';
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

  // Filtering and sorting happen here rather than in SQL: what a customer owes
  // is summed from their open invoices above, so the database cannot order by it
  // without a join this page does not otherwise need.
  const needle = q.trim().toLowerCase();
  const owed = (id: string) => outstanding.get(id)?.total ?? 0;

  let visible = debtors ?? [];
  if (show === 'muted') visible = visible.filter((d) => d.muted);
  if (show === 'unreachable') visible = visible.filter((d) => !d.email && !d.phone);
  if (needle) {
    visible = visible.filter((d) =>
      [d.name, d.email, d.phone, d.vat_number]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }

  visible = [...visible].sort((a, b) => {
    const order =
      sort === 'debt'
        ? owed(b.id) - owed(a.id)
        : (displayName(a) ?? '').localeCompare(displayName(b) ?? '');
    return descending ? -order : order;
  });

  const link = (next: Record<string, string>) =>
    `/debtors?${new URLSearchParams({ q, sort, dir, show, ...next })}`;

  const SHOW_KEYS = [
    { key: 'all', label: t.debtors.filterAll },
    { key: 'muted', label: t.debtors.filterMuted },
    { key: 'unreachable', label: t.debtors.filterUnreachable },
  ];

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {SHOW_KEYS.map((option) => (
            <a
              key={option.key}
              href={link({ show: option.key })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                show === option.key
                  ? 'bg-ink-900 text-white'
                  : 'border border-ink-300 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              {option.label}
            </a>
          ))}
        </div>

        <div className="flex gap-1 text-sm">
          {[
            { key: 'name', label: t.debtors.sortName },
            { key: 'debt', label: t.debtors.sortDebt },
          ].map((option) => (
            <a
              key={option.key}
              href={link({ sort: option.key, dir: sort === option.key && !descending ? 'desc' : 'asc' })}
              className={`rounded-lg px-2.5 py-1.5 ${
                sort === option.key ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {option.label}
              {sort === option.key ? (descending ? ' ↓' : ' ↑') : ''}
            </a>
          ))}
        </div>

        <form method="get" className="flex-1 sm:max-w-xs">
          <input type="hidden" name="show" value={show} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.debtors.search}
            aria-label={t.debtors.search}
            className="w-full rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </form>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.debtors.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {t.debtors.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/debtors/import" className={`text-sm ${subtleLinkClass}`}>
            Import z pliku
          </Link>
          <CreateDebtorForm />
        </div>
      </div>

      <Card>
        <CardHeader title={t.debtors.count(debtors?.length ?? 0)} />

        {!visible.length ? (
          <EmptyState
            title={t.debtors.emptyTitle}
            body={t.debtors.emptyBody}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {visible.map((debtor) => {
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
