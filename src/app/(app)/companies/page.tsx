import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, ButtonLink, Card, CardHeader, EmptyState, Stat } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { athensDate, formatMoney } from '@/lib/money';
import { activeOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

import { switchOrganization } from './actions';

export async function generateMetadata() {
  return { title: (await getDictionary()).companies.title };
}
export const dynamic = 'force-dynamic';

/**
 * Every company this login can act for, and what each one is owed.
 *
 * This is the screen the accountant channel is built on. Two hundred clients
 * cannot be worked one switch at a time: the question in the morning is "who
 * needs me today", and answering it by opening two hundred dashboards is not
 * answering it. One aggregate, ordered by what is late.
 *
 * It reads through a security-definer function because the policy on `users`
 * shows exactly one company — the active one. Crossing companies is precisely
 * what this page does, so it has to be a function that checks memberships
 * itself rather than a select that cannot see past the header.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const { q = '', sort = 'attention' } = await searchParams;
  const t = await getDictionary();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const active = await activeOrganization();
  const { data } = await supabase.rpc('my_organizations_summary', { p_today: athensDate() });

  const all = data ?? [];
  const needle = q.trim().toLowerCase();

  const rows = all.filter(
    (row) =>
      !needle ||
      (row.company_name ?? '').toLowerCase().includes(needle) ||
      (row.vat_number ?? '').includes(needle),
  );

  const ordered = [...rows].sort((a, b) => {
    if (sort === 'name') {
      return (a.company_name ?? '').localeCompare(b.company_name ?? '');
    }
    // Default: whoever is furthest behind, then by what is at stake. A company
    // with nothing overdue is not asking for anything today.
    return b.overdue_count - a.overdue_count || b.open_cents - a.open_cents;
  });

  const totalOpen = all.reduce((sum, row) => sum + row.open_cents, 0);
  const totalOverdue = all.reduce((sum, row) => sum + row.overdue_count, 0);

  const link = (next: Record<string, string>) =>
    `/companies?${new URLSearchParams({ q, sort, ...next })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.companies.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">{t.companies.subtitle}</p>
        </div>
        <ButtonLink href="/companies/new">{t.companies.add}</ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t.companies.countLabel} value={String(all.length)} />
        <Stat
          label={t.companies.totalOpen}
          value={formatMoney(totalOpen)}
          tone={totalOpen > 0 ? 'warning' : 'default'}
        />
        <Stat
          label={t.companies.totalOverdue}
          value={String(totalOverdue)}
          hint={t.companies.totalOverdueHint}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 text-sm">
          {[
            { key: 'attention', label: t.companies.sortAttention },
            { key: 'name', label: t.companies.sortName },
          ].map((option) => (
            <a
              key={option.key}
              href={link({ sort: option.key })}
              className={`rounded-lg px-2.5 py-1.5 ${
                sort === option.key ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {option.label}
            </a>
          ))}
        </div>

        <form method="get" className="flex-1 sm:max-w-xs">
          <input type="hidden" name="sort" value={sort} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.companies.searchPlaceholder}
            aria-label={t.companies.searchPlaceholder}
            className="min-h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
          />
        </form>
      </div>

      <Card>
        <CardHeader title={t.companies.listTitle(rows.length)} />

        {!ordered.length ? (
          <EmptyState title={t.companies.emptyTitle} body={t.companies.emptyBody} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {ordered.map((row) => (
              <li key={row.organization_id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">
                        {row.company_name ?? t.companies.unnamed}
                      </span>
                      {row.organization_id === active?.id ? (
                        <Badge tone="info">{t.companies.current}</Badge>
                      ) : null}
                      {row.role === 'viewer' ? (
                        <Badge tone="neutral">{t.members.roleViewer}</Badge>
                      ) : null}
                      {row.overdue_count > 0 ? (
                        <Badge tone="danger">{t.companies.overdue(row.overdue_count)}</Badge>
                      ) : null}
                    </div>
                    <p className="tabular mt-1 text-xs text-ink-500">
                      {row.vat_number ? `${t.debtors.vat} ${row.vat_number}` : t.companies.noVat}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-ink-400">
                      {t.debtors.outstandingLabel}
                    </p>
                    <p className="tabular mt-0.5 text-sm font-semibold text-ink-900">
                      {formatMoney(row.open_cents)}
                    </p>
                    <p className="text-xs text-ink-500">{t.debtors.openCount(row.open_count)}</p>
                  </div>

                  {row.organization_id === active?.id ? (
                    <Link
                      href="/dashboard"
                      className="inline-flex rounded-lg border border-ink-300 min-h-11 px-3 sm:min-h-0 sm:py-1.5 items-center text-sm text-ink-700 transition hover:bg-ink-50"
                    >
                      {t.companies.openDashboard}
                    </Link>
                  ) : (
                    <form action={switchOrganization}>
                      <input type="hidden" name="id" value={row.organization_id} />
                      <input type="hidden" name="next" value="/dashboard" />
                      <button
                        type="submit"
                        className="inline-flex rounded-lg border border-ink-300 min-h-11 px-3 sm:min-h-0 sm:py-1.5 items-center text-sm text-ink-700 transition hover:bg-ink-50"
                      >
                        {t.companies.open}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
