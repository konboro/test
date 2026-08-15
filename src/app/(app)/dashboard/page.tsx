import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, linkClass, Stat } from '@/components/ui';
import { workflowStatus } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
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
  const [{ data: profile }, { data: invoices }, { data: debtors }, { data: contacts }] =
    await Promise.all([
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
    ]);

  const allInvoices = invoices ?? [];
  const pending = allInvoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter((i) => daysBetween(i.due_date, today) > 0);

  const outstandingCents = pending.reduce((sum, i) => sum + i.amount_cents, 0);
  const overdueCents = overdue.reduce((sum, i) => sum + i.amount_cents, 0);

  const collectedCents = allInvoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Stat
          label={t.dashboard.smsBalance}
          value={String(profile?.sms_credits ?? 0)}
          hint={(profile?.sms_credits ?? 0) < 20 ? t.dashboard.smsLow : t.dashboard.smsOk}
          tone={(profile?.sms_credits ?? 0) < 20 ? 'warning' : 'default'}
        />
      </div>

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
                        {debtor.vat_number ? <span>ΑΦΜ {debtor.vat_number}</span> : null}
                        {debtor.muted ? <Badge tone="neutral">σε παύση</Badge> : null}
                        {!debtor.email && !debtor.phone ? (
                          <Badge tone="danger">χωρίς στοιχεία</Badge>
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
