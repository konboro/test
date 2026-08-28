import Link from 'next/link';

import { Badge, Card, CardHeader, EmptyState, linkClass, subtleLinkClass } from '@/components/ui';
import { displayName } from '@/lib/debtors';
import { getDictionary } from '@/lib/i18n';
import { nextChargeDate } from '@/lib/leases/schedule';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { requireOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

import { toggleLease } from './actions';
import { CreateLeaseForm } from './lease-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).leases.title };
}

export const dynamic = 'force-dynamic';

export default async function LeasesPage() {
  const t = await getDictionary();

  // Viewing, not writing. A viewer belongs here — sending them to /login
  // tells them their session expired, which it did not.
  // Called for its guard, not its value: it sends somebody with no company at
  // all to create one, and the queries below are scoped by policy.
  await requireOrganization();

  const supabase = await createClient();
  const today = athensDate();

  const [{ data: leases }, { data: debtors }] = await Promise.all([
    supabase
      .from('leases')
      .select('*')
      .order('active', { ascending: false })
      .order('property', { ascending: true }),
    supabase.from('debtors').select('id, name, vat_number, email, phone'),
  ]);

  const debtorsById = new Map((debtors ?? []).map((debtor) => [debtor.id, debtor]));

  const rows = (leases ?? []).map((lease) => {
    const debtor = debtorsById.get(lease.debtor_id);

    return {
      lease,
      tenant: debtor ? displayName(debtor) : null,
      next: nextChargeDate(
        {
          dueDay: lease.due_day,
          startsOn: lease.starts_on,
          endsOn: lease.ends_on,
          generateFrom: lease.generate_from,
          active: lease.active,
        },
        today,
      ),
    };
  });

  const options = (debtors ?? [])
    .map((debtor) => ({ id: debtor.id, name: displayName(debtor) || debtor.id.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.leases.title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">
            {t.leases.subtitle}
          </p>
        </div>
      </div>

      {/* A lease needs somebody to owe the rent, and the tenant is an ordinary
          customer record. Saying so beats a disabled button with no explanation. */}
      {options.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.leases.needTenant}{' '}
          <Link href="/debtors" className="font-medium underline">
            {t.leases.goToDebtors}
          </Link>
        </div>
      ) : (
        <CreateLeaseForm
          debtors={options}
          today={today}
          defaultGenerateFrom={`${today.slice(0, 7)}-01`}
        />
      )}

      <Card>
        <CardHeader title={t.leases.title} />

        {rows.length === 0 ? (
          <EmptyState title={t.leases.emptyTitle} body={t.leases.emptyBody} />
        ) : (
          <>
            {/* Five columns with an address in one of them is wider than a phone.
                Below `md` a lease reads as a card: the flat, the rent, when the
                next charge lands. */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {rows.map(({ lease, tenant, next }) => (
                <li key={lease.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{lease.property}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {lease.debtor_id ? (
                          <Link href={`/debtors/${lease.debtor_id}`} className={subtleLinkClass}>
                            {tenant ?? t.debtors.nameMissing}
                          </Link>
                        ) : (
                          (tenant ?? t.debtors.nameMissing)
                        )}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-ink-500">
                        {t.leases.monthly('', lease.due_day).trim()}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-base font-semibold text-ink-900">
                      {formatMoney(lease.amount_cents, lease.currency)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {lease.active ? (
                      <Badge tone="positive">{t.leases.active}</Badge>
                    ) : (
                      <Badge tone="neutral">{t.leases.paused}</Badge>
                    )}
                    {next ? (
                      <span className="tabular text-xs text-ink-500">
                        {t.leases.colNext}: {formatDate(next)}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-500">{t.leases.ended}</span>
                    )}
                  </div>

                  <form action={toggleLease} className="mt-3">
                    <input type="hidden" name="id" value={lease.id} />
                    <input type="hidden" name="active" value={String(lease.active)} />
                    <button
                      type="submit"
                      className={`inline-flex min-h-11 items-center sm:min-h-0 text-sm ${subtleLinkClass}`}
                      title={lease.active ? t.leases.pauseHint : t.leases.resumeHint}
                    >
                      {lease.active ? t.leases.pause : t.leases.resume}
                    </button>
                  </form>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-5 py-2.5 font-medium">{t.leases.colProperty}</th>
                    <th className="px-5 py-2.5 font-medium">{t.leases.colTenant}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.leases.colRent}</th>
                    <th className="px-5 py-2.5 font-medium">{t.leases.colNext}</th>
                    <th className="px-5 py-2.5 font-medium">{t.leases.colState}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ lease, tenant, next }) => (
                    <tr key={lease.id} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-ink-900">{lease.property}</td>
                      <td className="px-5 py-3">
                        <Link href={`/debtors/${lease.debtor_id}`} className={subtleLinkClass}>
                          {tenant ?? t.debtors.nameMissing}
                        </Link>
                      </td>
                      <td className="tabular px-5 py-3 text-right font-medium text-ink-900">
                        {formatMoney(lease.amount_cents, lease.currency)}
                        <div className="text-xs font-normal text-ink-500">
                          {t.leases.monthly('', lease.due_day).trim()}
                        </div>
                      </td>
                      <td className="tabular px-5 py-3 text-ink-600">
                        {next ? formatDate(next) : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {lease.active ? (
                          <Badge tone="positive">{t.leases.active}</Badge>
                        ) : (
                          <Badge tone="neutral">{t.leases.paused}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <form action={toggleLease}>
                          <input type="hidden" name="id" value={lease.id} />
                          <input type="hidden" name="active" value={String(lease.active)} />
                          <button
                            type="submit"
                            className={`inline-flex min-h-11 items-center sm:min-h-0 text-sm ${subtleLinkClass}`}
                            title={lease.active ? t.leases.pauseHint : t.leases.resumeHint}
                          >
                            {lease.active ? t.leases.pause : t.leases.resume}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title={t.leases.howTitle} />
        <div className="px-5 py-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-600">{t.leases.howBody}</p>
          <p className="mt-3 text-sm">
            <Link href="/invoices" className={linkClass}>
              {t.nav.invoices}
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
