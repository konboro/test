import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, linkClass, Stat } from '@/components/ui';
import { displayName } from '@/lib/debtors';
import { workflowStatus } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
import { smsCreditsEnforced } from '@/lib/limits';
import { athensDate, daysBetween, formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { ElorusSyncButton, SyncButton } from './sync-button';

export async function generateMetadata() {
  return { title: (await getDictionary()).dashboard.title };
}
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const today = athensDate();

  // RLS scopes every one of these to the signed-in tenant.
  const [
    { data: profile },
    { data: invoices },
    { data: debtors },
    { data: contacts },
    { data: recentPayments },
  ] = await Promise.all([
      supabase
        .from('users')
        .select(
          'company_name, sms_credits, mydata_user_id, mydata_last_sync_at, automation_enabled, elorus_organization_id, elorus_last_sync_at',
        )
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, debtor_id, amount_cents, currency, due_date, status, invoice_number, series, mark')
        .in('status', ['pending', 'paid'])
        .order('due_date', { ascending: true }),
      supabase.from('debtors').select('id, name, vat_number, email, phone, muted'),
      supabase.from('dunning_contacts').select('invoice_id, debtor_id, step, contact_on'),
      supabase
        .from('invoices')
        .select('id, debtor_id, amount_cents, currency, paid_at, paid_amount_cents, invoice_number, series, mark')
        .eq('status', 'paid')
        .not('stripe_checkout_session_id', 'is', null)
        .order('paid_at', { ascending: false })
        .limit(8),
    ]);

  const allInvoices = invoices ?? [];
  const pending = allInvoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter((i) => daysBetween(i.due_date, today) > 0);

  const outstandingCents = pending.reduce((sum, i) => sum + i.amount_cents, 0);
  const overdueCents = overdue.reduce((sum, i) => sum + i.amount_cents, 0);

  const collectedCents = allInvoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);

  // Aging buckets over the open balance. The thresholds mirror the ladder: at
  // 1–9 days overdue the automated steps are still doing the chasing; from day
  // 10 the final reminder has fired and the money is the operator's problem.
  const agingBuckets = [
    { key: 'notDue', label: t.dashboard.agingNotDue, swatch: 'bg-brand-500', match: (d: number) => d <= 0 },
    { key: 'late1to9', label: t.dashboard.agingLate(1, 9), swatch: 'bg-amber-500', match: (d: number) => d >= 1 && d <= 9 },
    { key: 'late10plus', label: t.dashboard.agingLatePlus(10), swatch: 'bg-red-500', match: (d: number) => d >= 10 },
  ].map((bucket) => {
    const own = pending.filter((i) => bucket.match(daysBetween(i.due_date, today)));
    return { ...bucket, count: own.length, cents: own.reduce((sum, i) => sum + i.amount_cents, 0) };
  });

  // Steps already fired, per invoice. Manual reminders carry no step — they are
  // contacts, not rungs, and must not move an invoice along the ladder.
  const stepsByInvoice = new Map<string, Set<DunningStep>>();
  for (const c of contacts ?? []) {
    if (!c.step) continue;
    const set = stepsByInvoice.get(c.invoice_id) ?? new Set<DunningStep>();
    set.add(c.step);
    stepsByInvoice.set(c.invoice_id, set);
  }

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  // Roll pending invoices up per debtor for the overview table.
  const rows = [...debtorsById.values()]
    .map((debtor) => {
      const own = pending.filter((i) => i.debtor_id === debtor.id);
      const total = own.reduce((sum, i) => sum + i.amount_cents, 0);
      const oldest = own.reduce<(typeof own)[number] | null>(
        (worst, i) => (!worst || i.due_date < worst.due_date ? i : worst),
        null,
      );

      const status = oldest
        ? workflowStatus(oldest, stepsByInvoice.get(oldest.id) ?? new Set(), today, t)
        : null;

      const lastContact = (contacts ?? [])
        .filter((c) => c.debtor_id === debtor.id)
        .map((c) => c.contact_on)
        .sort()
        .at(-1);

      return { debtor, count: own.length, total, oldest, status, lastContact };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.total - a.total);

  const unreachable = (debtors ?? []).filter(
    (d) => !d.email && !d.phone && pending.some((i) => i.debtor_id === d.id),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.dashboard.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {profile?.mydata_last_sync_at
              ? t.dashboard.lastSync(
                  new Date(profile.mydata_last_sync_at).toLocaleString(t.dateTimeTag),
                )
              : t.dashboard.neverSynced}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ElorusSyncButton configured={Boolean(profile?.elorus_organization_id)} />
          <SyncButton configured={Boolean(profile?.mydata_user_id)} />
        </div>
      </div>

      {profile && !profile.automation_enabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.dashboard.automationOff}{' '}
          <Link href="/settings" className="font-medium underline">
            {t.dashboard.settingsLink}
          </Link>
        </div>
      ) : null}

      {unreachable > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.dashboard.unreachable(unreachable)}{' '}
          <Link href="/debtors" className="font-medium underline">
            {t.dashboard.fixContacts}
          </Link>
        </div>
      ) : null}

      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          smsCreditsEnforced() ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        }`}
      >
        <Stat
          label={t.dashboard.outstanding}
          value={formatMoney(outstandingCents)}
          hint={t.dashboard.outstandingHint(pending.length)}
        />
        <Stat
          label={t.dashboard.overdue}
          value={formatMoney(overdueCents)}
          hint={t.dashboard.overdueHint(overdue.length)}
          tone={overdueCents > 0 ? 'warning' : 'default'}
        />
        <Stat
          label={t.dashboard.collected}
          value={formatMoney(collectedCents)}
          hint={t.dashboard.collectedHint}
          tone="positive"
        />
        {smsCreditsEnforced() ? (
          <Stat
            label={t.dashboard.smsBalance}
            value={String(profile?.sms_credits ?? 0)}
            hint={(profile?.sms_credits ?? 0) < 20 ? t.dashboard.smsLow : t.dashboard.smsOk}
            tone={(profile?.sms_credits ?? 0) < 20 ? 'warning' : 'default'}
          />
        ) : null}
      </div>

      {outstandingCents > 0 ? (
        <Card>
          <CardHeader title={t.dashboard.aging} subtitle={t.dashboard.agingHint} />
          <div className="px-5 py-5">
            {/* One stacked strip; the 2px gaps are the card surface doing the
                separating, so no segment needs a border. */}
            <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={t.dashboard.aging}>
              {agingBuckets
                .filter((bucket) => bucket.cents > 0)
                .map((bucket) => (
                  <div
                    key={bucket.key}
                    className={`${bucket.swatch} first:rounded-l-full last:rounded-r-full`}
                    style={{
                      width: `${(bucket.cents / outstandingCents) * 100}%`,
                      minWidth: '8px',
                    }}
                    title={`${bucket.label}: ${formatMoney(bucket.cents)}`}
                  />
                ))}
            </div>

            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
              {agingBuckets.map((bucket) => (
                <div key={bucket.key} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 translate-y-px rounded-sm ${bucket.swatch}`}
                  />
                  <dt className="text-xs text-ink-500">{bucket.label}</dt>
                  <dd className="tabular text-sm font-semibold text-ink-900">
                    {formatMoney(bucket.cents)}
                  </dd>
                  <dd className="text-xs text-ink-400">{t.dashboard.agingInvoices(bucket.count)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t.recentPayments.title} subtitle={t.recentPayments.subtitle} />

        {!recentPayments?.length ? (
          <EmptyState title={t.recentPayments.emptyTitle} body={t.recentPayments.emptyBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">{t.recentPayments.colWhen}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colCustomer}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colInvoice}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((payment) => {
                  const customer = debtorsById.get(payment.debtor_id);
                  const name = customer ? displayName(customer) : null;
                  const number =
                    [payment.series, payment.invoice_number].filter(Boolean).join(' ') ||
                    payment.mark ||
                    payment.id.slice(0, 8);

                  return (
                    <tr key={payment.id} className="border-b border-ink-100 last:border-0">
                      <td className="tabular px-5 py-3 text-ink-600">
                        {payment.paid_at
                          ? new Date(payment.paid_at).toLocaleString(t.dateTimeTag)
                          : '—'}
                      </td>
                      <td className="px-5 py-3">
                        {name ? (
                          <span className="text-ink-800">{name}</span>
                        ) : (
                          <span className="italic text-ink-400">{t.debtors.nameMissing}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-700">{number}</td>
                      <td className="tabular px-5 py-3 text-right font-medium text-emerald-700">
                        {formatMoney(payment.paid_amount_cents ?? payment.amount_cents, payment.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t.dashboard.openBalances}
          subtitle={t.dashboard.openBalancesHint}
          action={
            <Link href="/debtors" className={`text-sm ${linkClass}`}>
              {t.dashboard.allCustomers}
            </Link>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            title={t.dashboard.emptyTitle}
            body={t.dashboard.emptyBody}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">{t.dashboard.colCustomer}</th>
                  <th className="px-5 py-2.5 font-medium">{t.dashboard.colInvoices}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.dashboard.colBalance}</th>
                  <th className="px-5 py-2.5 font-medium">{t.dashboard.colOldestDue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.dashboard.colWorkflow}</th>
                  <th className="px-5 py-2.5 font-medium">{t.dashboard.colLastContact}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ debtor, count, total, oldest, status, lastContact }) => (
                  <tr key={debtor.id} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-3">
                      <Link href="/debtors" className="font-medium text-ink-900 underline-offset-2 transition hover:text-brand-600 hover:underline">
                        {debtor.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                        {debtor.vat_number ? <span>{t.debtors.vat} {debtor.vat_number}</span> : null}
                        {debtor.muted ? <Badge tone="neutral">{t.dashboard.muted}</Badge> : null}
                        {!debtor.email && !debtor.phone ? (
                          <Badge tone="danger">{t.dashboard.noContact}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular px-5 py-3 text-ink-600">{count}</td>
                    <td className="tabular px-5 py-3 text-right font-medium text-ink-900">
                      {formatMoney(total)}
                    </td>
                    <td className="tabular px-5 py-3 text-ink-600">
                      {oldest ? formatDate(oldest.due_date) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {status ? <Badge tone={status.tone}>{status.label}</Badge> : '—'}
                    </td>
                    <td className="tabular px-5 py-3 text-ink-500">
                      {lastContact ? formatDate(lastContact) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
