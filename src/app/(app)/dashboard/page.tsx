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

import { DataSources } from './data-sources';

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

  // The funnel window: how far back reminders and link activity are counted.
  const FUNNEL_DAYS = 30;
  /** An invoice counts as converted when it settles this soon after a contact. */
  const ATTRIBUTION_DAYS = 7;
  const funnelSince = new Date(Date.now() - FUNNEL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // RLS scopes every one of these to the company this session is acting for.
  const [
    { data: profile },
    { data: invoices },
    { data: debtors },
    { data: contacts },
    { data: recentPayments },
    { data: recentComms },
    { data: funnelEvents },
    { data: bankConnections },
  ] = await Promise.all([
      supabase
        .from('users')
        .select(
          'company_name, sms_credits, mydata_user_id, mydata_last_sync_at, automation_enabled, elorus_organization_id, elorus_last_sync_at',
        )
        // No filter: the policy already shows exactly the active company, and
        // the signed-in person's id is not it once they act for more than one.
        .limit(1)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, debtor_id, amount_cents, currency, due_date, status, paid_at, invoice_number, series, mark')
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
      supabase
        .from('communications_log')
        .select('invoice_id, channel, status, sent_at')
        .eq('status', 'sent')
        .gte('sent_at', funnelSince)
        .limit(5000),
      supabase
        .from('funnel_events')
        .select('invoice_id, debtor_id, channel, event, occurred_at')
        .gte('occurred_at', funnelSince)
        .limit(5000),
      // The third data source. Its freshness belongs beside the other two, and
      // until now it was only visible from the settings screen.
      supabase.from('bank_connections').select('status, last_synced_at'),
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

  // The reminder funnel, per channel, over the last FUNNEL_DAYS. Every count is
  // distinct invoices — a refreshed page or a resent message is not engagement
  // growth. "Paid" is an invoice settled within ATTRIBUTION_DAYS of a sent
  // contact on that channel; a debtor who reads the SMS and pays by transfer
  // never clicks anything, which is why payment timing is counted per channel
  // rather than clicks alone (docs/funnel-analytics.md).
  const paidAtByInvoice = new Map(
    allInvoices
      .filter((i) => i.status === 'paid' && i.paid_at)
      .map((i) => [i.id, new Date(i.paid_at as string).getTime()]),
  );

  const funnelRows = (['email', 'sms'] as const).map((channel) => {
    const sentInvoices = new Map<string, number>();
    for (const comm of recentComms ?? []) {
      if (comm.channel !== channel || !comm.invoice_id) continue;
      const at = new Date(comm.sent_at).getTime();
      const earliest = sentInvoices.get(comm.invoice_id);
      if (earliest === undefined || at < earliest) sentInvoices.set(comm.invoice_id, at);
    }

    const opened = new Set<string>();
    const checkout = new Set<string>();
    for (const event of funnelEvents ?? []) {
      if (event.channel !== channel) continue;
      if (event.event === 'page_view') opened.add(event.invoice_id);
      if (event.event === 'checkout_started') checkout.add(event.invoice_id);
    }

    let paid = 0;
    const attributionMs = ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;
    for (const [invoiceId, sentAt] of sentInvoices) {
      const paidAt = paidAtByInvoice.get(invoiceId);
      if (paidAt !== undefined && paidAt >= sentAt && paidAt <= sentAt + attributionMs) paid += 1;
    }

    return { channel, sent: sentInvoices.size, opened: opened.size, checkout: checkout.size, paid };
  });


  const funnelHasData =
    funnelRows.some((row) => row.sent > 0) || (funnelEvents?.length ?? 0) > 0;
  const untaggedViews = new Set(
    (funnelEvents ?? [])
      .filter((event) => event.event === 'page_view' && event.channel === 'other')
      .map((event) => event.invoice_id),
  ).size;

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

  /**
   * The funnel one row per invoice, rather than as four totals.
   *
   * Totals answer whether the channel works; this answers who to call. An
   * operator looking at "3 opened, 1 paid" cannot act on it — the two who
   * opened and did not pay are the entire point of the screen.
   *
   * Earliest event of each kind wins: a debtor who opens the link four times
   * engaged once, and counting the refreshes would make the busiest procrastinator
   * look like the warmest lead.
   */
  const activity = (() => {
    const byInvoice = new Map<
      string,
      { opened: string | null; started: string | null; channel: string }
    >();

    for (const event of funnelEvents ?? []) {
      if (!event.invoice_id) continue;
      const row = byInvoice.get(event.invoice_id) ?? {
        opened: null,
        started: null,
        // An untagged visit is a real visit; it just cannot say which message
        // brought it, so it starts as 'other' and yields to a tagged one below.
        channel: event.channel ?? 'other',
      };
      const at = event.occurred_at;

      if (event.event === 'page_view' && (!row.opened || at < row.opened)) row.opened = at;
      if (event.event === 'checkout_started' && (!row.started || at < row.started)) row.started = at;
      // A tagged event names the message that brought them; it always beats an
      // untagged visit already recorded for the same invoice.
      if (event.channel && event.channel !== 'other') row.channel = event.channel;

      byInvoice.set(event.invoice_id, row);
    }

    return [...byInvoice.entries()]
      .map(([invoiceId, row]) => {
        const invoice = allInvoices.find((i) => i.id === invoiceId);
        const debtor = invoice ? debtorsById.get(invoice.debtor_id) : undefined;

        return {
          invoiceId,
          label: invoice
            ? [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || invoice.mark || invoiceId.slice(0, 8)
            : invoiceId.slice(0, 8),
          name: debtor ? displayName(debtor) : null,
          amountCents: invoice?.amount_cents ?? 0,
          currency: invoice?.currency,
          ...row,
          paidAt: invoice?.status === 'paid' ? (invoice.paid_at ?? null) : null,
        };
      })
      // Newest engagement first: the person who just opened the link is the
      // one worth a call today.
      .sort((a, b) => (b.started ?? b.opened ?? '').localeCompare(a.started ?? a.opened ?? ''));
  })();

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

  const bankActive = (bankConnections ?? []).filter((c) => c.status === 'active');

  const unreachable = (debtors ?? []).filter(
    (d) => !d.email && !d.phone && pending.some((i) => i.debtor_id === d.id),
  ).length;

  return (
    <div className="space-y-6">
      {/* The title stands alone now. It used to carry myDATA's last sync time
          as though that spoke for every source, which it never did — the
          billing system and the bank had their own clocks and neither was
          shown. All three are reported together, further down. */}
      <h1 className="text-xl font-semibold text-ink-900">{t.dashboard.title}</h1>

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

      {/* Two columns on a phone rather than one. Four full-width tiles pushed
          everything else below the fold, and these are the numbers the page
          exists to show. */}
      <div
        className={`grid grid-cols-2 gap-3 sm:gap-4 ${
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

      <DataSources
        sources={{
          billing: {
            configured: Boolean(profile?.elorus_organization_id),
            lastSync: profile?.elorus_last_sync_at ?? null,
          },
          mydata: {
            configured: Boolean(profile?.mydata_user_id),
            lastSync: profile?.mydata_last_sync_at ?? null,
          },
          bank: {
            configured: bankActive.length > 0,
            // The most recent read across every connected account: one stale
            // account among several is still a reason to press the button.
            lastSync:
              bankActive
                .map((c) => c.last_synced_at)
                .filter((at): at is string => Boolean(at))
                .sort()
                .at(-1) ?? null,
          },
        }}
      />

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
        <CardHeader title={t.dashboard.funnel} subtitle={t.dashboard.funnelHint} />

        {!funnelHasData ? (
          <EmptyState title={t.dashboard.funnelEmptyTitle} body={t.dashboard.funnelEmptyBody} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-5 py-2.5 font-medium">{t.dashboard.funnelChannel}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.dashboard.funnelSent}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.dashboard.funnelOpened}</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      {t.dashboard.funnelCheckout}
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.dashboard.funnelPaid}</th>
                  </tr>
                </thead>
                <tbody>
                  {funnelRows.map((row) => {
                    const pct = (part: number) =>
                      row.sent > 0 ? `${Math.round((part / row.sent) * 100)}%` : null;

                    const cell = (value: number, share: string | null) => (
                      <td className="px-5 py-3 text-right">
                        <div className="tabular font-medium text-ink-900">{value}</div>
                        {share !== null ? (
                          <div className="tabular text-xs text-ink-400">{share}</div>
                        ) : null}
                      </td>
                    );

                    return (
                      <tr key={row.channel} className="border-b border-ink-100 last:border-0">
                        <td className="px-5 py-3">
                          <Badge tone={row.channel === 'sms' ? 'info' : 'neutral'}>
                            {row.channel === 'sms' ? t.common.sms : t.common.email}
                          </Badge>
                        </td>
                        {cell(row.sent, null)}
                        {cell(row.opened, pct(row.opened))}
                        {cell(row.checkout, pct(row.checkout))}
                        {cell(row.paid, pct(row.paid))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {untaggedViews > 0 ? (
              <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
                {t.dashboard.funnelUntagged(untaggedViews)}
              </p>
            ) : null}

            {/* Who, not how many. The totals above say whether a channel works;
                this says which customer opened the link and stopped — which is
                the only part of the funnel anyone can act on today. */}
            {activity.length ? (
              <div className="border-t border-ink-200">
                <p className="px-5 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-ink-400">
                  {t.dashboard.activityTitle}
                </p>
                {/* Five columns, two of them dates that are usually a dash. On a
                    phone each row becomes one line of prose: who, on what, and
                    how far they got. */}
                <ul className="divide-y divide-ink-100 md:hidden">
                  {activity.slice(0, 20).map((row) => (
                    <li key={row.invoiceId} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink-800">
                            {row.name ?? t.debtors.nameMissing}
                          </p>
                          <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                            {row.label}
                          </p>
                        </div>
                        {row.paidAt ? (
                          <span className="tabular shrink-0 text-sm font-medium text-emerald-700">
                            {formatMoney(row.amountCents, row.currency)}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <Badge tone={row.channel === 'sms' ? 'info' : 'neutral'}>
                          {row.channel === 'sms'
                            ? t.common.sms
                            : row.channel === 'email'
                              ? t.common.email
                              : t.dashboard.activityDirect}
                        </Badge>
                        {row.opened ? (
                          <span className="tabular">
                            {t.dashboard.activityOpened}: {formatDate(row.opened.slice(0, 10))}
                          </span>
                        ) : null}
                        {row.started ? (
                          <span className="tabular">
                            {t.dashboard.activityStarted}: {formatDate(row.started.slice(0, 10))}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                        <th className="px-5 py-2 font-medium">{t.invoices.colCustomer}</th>
                        <th className="px-5 py-2 font-medium">{t.invoices.colInvoice}</th>
                        <th className="px-5 py-2 font-medium">{t.dashboard.activityOpened}</th>
                        <th className="px-5 py-2 font-medium">{t.dashboard.activityStarted}</th>
                        <th className="px-5 py-2 font-medium">{t.dashboard.activityPaid}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.slice(0, 20).map((row) => (
                        <tr key={row.invoiceId} className="border-b border-ink-100 last:border-0">
                          <td className="px-5 py-2.5">
                            <span className="text-ink-800">{row.name ?? t.debtors.nameMissing}</span>
                            <Badge tone={row.channel === 'sms' ? 'info' : 'neutral'}>
                              {row.channel === 'sms'
                                ? t.common.sms
                                : row.channel === 'email'
                                  ? t.common.email
                                  : t.dashboard.activityDirect}
                            </Badge>
                          </td>
                          <td className="tabular px-5 py-2.5 text-ink-600">{row.label}</td>
                          <td className="tabular px-5 py-2.5 text-ink-600">
                            {row.opened ? formatDate(row.opened.slice(0, 10)) : '—'}
                          </td>
                          <td className="tabular px-5 py-2.5 text-ink-600">
                            {row.started ? formatDate(row.started.slice(0, 10)) : '—'}
                          </td>
                          <td className="tabular px-5 py-2.5">
                            {row.paidAt ? (
                              <span className="font-medium text-emerald-700">
                                {formatMoney(row.amountCents, row.currency)}
                              </span>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activity.length > 20 ? (
                  <p className="px-5 py-2.5 text-xs text-ink-500">
                    {t.dashboard.activityMore(activity.length - 20)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <CardHeader title={t.recentPayments.title} subtitle={t.recentPayments.subtitle} />

        {!recentPayments?.length ? (
          <EmptyState title={t.recentPayments.emptyTitle} body={t.recentPayments.emptyBody} />
        ) : (
          <>
            {/* A settled payment is read as a line, not a grid: who paid, and
                how much. The timestamp goes underneath rather than first — it
                was taking the widest column on the narrowest screen to answer a
                question nobody had. */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {recentPayments.map((payment) => {
                const customer = debtorsById.get(payment.debtor_id);
                const name = customer ? displayName(customer) : null;
                const number =
                  [payment.series, payment.invoice_number].filter(Boolean).join(' ') ||
                  payment.mark ||
                  payment.id.slice(0, 8);

                return (
                  <li key={payment.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-800">
                        {name ?? (
                          <span className="italic text-ink-400">{t.debtors.nameMissing}</span>
                        )}
                      </p>
                      <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                        {number}
                        {payment.paid_at
                          ? ` · ${new Date(payment.paid_at).toLocaleDateString(t.dateTimeTag)}`
                          : ''}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-medium text-emerald-700">
                      {formatMoney(payment.paid_amount_cents ?? payment.amount_cents, payment.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
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
          </>
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
          <>
            {/* Six columns do not survive a phone. Below `md` the same rows are
                stacked as cards, so the balance and the state are readable
                without dragging a table sideways; from `md` up the table is
                still the better shape for comparing customers. */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {rows.map(({ debtor, count, total, oldest, status, lastContact }) => (
                <li key={debtor.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/debtors/${debtor.id}`}
                        className="font-medium text-ink-900 underline-offset-2 transition hover:text-brand-600 hover:underline"
                      >
                        {debtor.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {t.dashboard.colInvoices}: {count}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-base font-semibold text-ink-900">
                      {formatMoney(total)}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                    {debtor.muted ? <Badge tone="neutral">{t.dashboard.muted}</Badge> : null}
                    {!debtor.email && !debtor.phone ? (
                      <Badge tone="danger">{t.dashboard.noContact}</Badge>
                    ) : null}
                  </div>

                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
                    <div className="flex gap-1.5">
                      <dt>{t.dashboard.colOldestDue}:</dt>
                      <dd className="tabular text-ink-700">
                        {oldest ? formatDate(oldest.due_date) : '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t.dashboard.colLastContact}:</dt>
                      <dd className="tabular text-ink-700">
                        {lastContact ? formatDate(lastContact) : '—'}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
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
                      <Link
                        href={`/debtors/${debtor.id}`}
                        className="font-medium text-ink-900 underline-offset-2 transition hover:text-brand-600 hover:underline"
                      >
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
          </>
        )}
      </Card>
    </div>
  );
}
