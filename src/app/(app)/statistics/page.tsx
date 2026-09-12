import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, linkClass, Stat } from '@/components/ui';
import {
  agingBuckets,
  collectedAmounts,
  collectedThroughLefta,
  funnelRows as funnelRowsFor,
  funnelSince,
  stepsByInvoice as stepsFor,
  untaggedViews as untaggedViewsFor,
} from '@/lib/dashboard/figures';
import { DEFAULT_CURRENCY, totalsByCurrency } from '@/lib/currency';
import { displayName } from '@/lib/debtors';
import { workflowStatus } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
import { smsCreditsEnforced } from '@/lib/limits';
import { athensDate, daysBetween, formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

/**
 * The whole book, and how the chasing is performing.
 *
 * Everything here was on the overview, which had grown to eleven blocks and
 * reported the same money four times before it got to anything a person could
 * act on. These are the blocks worth keeping and worth nobody's first glance:
 * the portfolio totals, its shape by age, the reminder funnel per channel, and
 * the customer-by-customer balance. The overview keeps one figure, the drop
 * zone, the queue of things only a person can decide, and a one-line version of
 * the funnel that links here.
 */

/** Totals for a tile, one figure per currency, joined rather than added. */
function money(totals: ReturnType<typeof totalsByCurrency>): string {
  if (!totals.length) return formatMoney(0);
  return totals.map((total) => formatMoney(total.cents, total.currency)).join(' · ');
}

export async function generateMetadata() {
  return { title: (await getDictionary()).dashboard.statsTitle };
}

export const dynamic = 'force-dynamic';

export default async function StatisticsPage() {
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const today = athensDate();
  const since = funnelSince();

  // RLS scopes every one of these to the company this session is acting for.
  const [{ data: profile }, { data: invoices }, { data: debtors }, { data: contacts }, { data: sentComms }, { data: funnelEvents }] =
    await Promise.all([
      supabase.from('users').select('sms_credits').limit(1).maybeSingle(),
      supabase
        .from('invoices')
        .select(
          'id, debtor_id, amount_cents, currency, due_date, status, paid_at, paid_amount_cents, invoice_number, series, mark, stripe_payment_intent_id, viva_transaction_id, revolut_order_id',
        )
        .in('status', ['pending', 'paid'])
        .order('due_date', { ascending: true }),
      supabase.from('debtors').select('id, name, vat_number, email, phone, muted').order('name'),
      supabase.from('dunning_contacts').select('invoice_id, debtor_id, step, contact_on'),
      supabase
        .from('communications_log')
        .select('invoice_id, channel, status, sent_at')
        .eq('status', 'sent')
        .gte('sent_at', since)
        .limit(5000),
      supabase
        .from('funnel_events')
        .select('invoice_id, debtor_id, channel, event, occurred_at')
        .gte('occurred_at', since)
        .limit(5000),
    ]);

  const allInvoices = invoices ?? [];
  const pending = allInvoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter((i) => daysBetween(i.due_date, today) > 0);

  // Kept apart by currency rather than added together: there is no exchange
  // rate in this product and inventing one to keep a tidy single figure is how
  // a screen reports money that does not exist.
  const outstandingTotals = totalsByCurrency(pending);
  const overdueTotals = totalsByCurrency(overdue);
  const overdueCents = overdueTotals.reduce((sum, x) => sum + x.cents, 0);
  const collectedTotals = totalsByCurrency(collectedAmounts(collectedThroughLefta(allInvoices)));

  // The strip compares amounts against one another, so every figure in it has
  // to be in one currency: widths built from a mixture mean nothing. The
  // currency carrying the most outstanding leads the tiles, so the strip
  // follows it and the rest stay named in the tiles above.
  const stripCurrency = outstandingTotals[0]?.currency ?? DEFAULT_CURRENCY;
  const outstandingCents = outstandingTotals[0]?.cents ?? 0;
  const stripInvoices = pending.filter(
    (i) => (i.currency?.toUpperCase() || DEFAULT_CURRENCY) === stripCurrency,
  );

  const buckets = agingBuckets(stripInvoices, (i) => daysBetween(i.due_date, today), {
    notDue: t.dashboard.agingNotDue,
    late1to9: t.dashboard.agingLate(1, 9),
    late10plus: t.dashboard.agingLatePlus(10),
  });

  const paidAtByInvoice = new Map(
    allInvoices
      .filter((i) => i.status === 'paid' && i.paid_at)
      .map((i) => [i.id, new Date(i.paid_at as string).getTime()]),
  );

  const funnelRows = funnelRowsFor(
    ['email', 'sms'],
    sentComms ?? [],
    funnelEvents ?? [],
    paidAtByInvoice,
  );

  const funnelHasData = funnelRows.some((row) => row.sent > 0) || (funnelEvents?.length ?? 0) > 0;
  const untaggedViews = untaggedViewsFor(funnelEvents ?? []);

  const stepsByInvoice = stepsFor(contacts ?? []);
  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  /**
   * The funnel one row per invoice, rather than as four totals.
   *
   * Totals answer whether the channel works; this answers who to call. An
   * operator looking at "3 opened, 1 paid" cannot act on it — the two who
   * opened and did not pay are the entire point of the table.
   *
   * Earliest event of each kind wins: a debtor who opens the link four times
   * engaged once, and counting the refreshes would make the busiest
   * procrastinator look like the warmest lead.
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
      if (event.event === 'checkout_started' && (!row.started || at < row.started)) {
        row.started = at;
      }
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
            ? [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
              invoice.mark ||
              invoiceId.slice(0, 8)
            : invoiceId.slice(0, 8),
          name: debtor ? displayName(debtor) : null,
          amountCents: invoice?.amount_cents ?? 0,
          currency: invoice?.currency,
          ...row,
          paidAt: invoice?.status === 'paid' ? (invoice.paid_at ?? null) : null,
        };
      })
      // Newest engagement first: the person who just opened the link is the one
      // worth a call today.
      .sort((a, b) => (b.started ?? b.opened ?? '').localeCompare(a.started ?? a.opened ?? ''));
  })();

  // Pending invoices rolled up per customer.
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.dashboard.statsTitle}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.dashboard.statsHint}</p>
      </div>

      {/* The portfolio in full, including the two figures the overview no longer
          repeats: overdue is its own tile here, where a reader is comparing
          numbers rather than being told what to do next. */}
      <div
        className={`grid grid-cols-2 gap-3 sm:gap-4 ${
          smsCreditsEnforced() ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        }`}
      >
        <Stat
          label={t.dashboard.outstanding}
          value={money(outstandingTotals)}
          hint={t.dashboard.outstandingHint(pending.length)}
        />
        <Stat
          label={t.dashboard.overdue}
          value={money(overdueTotals)}
          hint={t.dashboard.overdueHint(overdue.length)}
          tone={overdueCents > 0 ? 'warning' : 'default'}
        />
        <Stat
          label={t.dashboard.collected}
          value={money(collectedTotals)}
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
              {buckets
                .filter((bucket) => bucket.cents > 0)
                .map((bucket) => (
                  <div
                    key={bucket.key}
                    className={`${bucket.swatch} first:rounded-l-full last:rounded-r-full`}
                    style={{
                      width: `${(bucket.cents / outstandingCents) * 100}%`,
                      minWidth: '8px',
                    }}
                    title={`${bucket.label}: ${formatMoney(bucket.cents, stripCurrency)}`}
                  />
                ))}
            </div>

            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
              {buckets.map((bucket) => (
                <div key={bucket.key} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 translate-y-px rounded-sm ${bucket.swatch}`}
                  />
                  <dt className="text-xs text-ink-500">{bucket.label}</dt>
                  <dd className="tabular text-sm font-semibold text-ink-900">
                    {formatMoney(bucket.cents, stripCurrency)}
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
            {/* The other tables on this page have a card list behind them; this
                one did not, so on a phone it was a sideways drag with the number
                that matters — paid — always off the edge. */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {funnelRows.map((row) => {
                const pct = (part: number) =>
                  row.sent > 0 ? `${Math.round((part / row.sent) * 100)}%` : null;

                const stat = (label: string, value: number, share: string | null) => (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
                    <dd className="tabular mt-0.5 text-sm font-medium text-ink-900">
                      {value}
                      {share !== null ? (
                        <span className="ml-1.5 text-xs font-normal text-ink-400">{share}</span>
                      ) : null}
                    </dd>
                  </div>
                );

                return (
                  <li key={row.channel} className="px-4 py-4">
                    <Badge tone={row.channel === 'sms' ? 'info' : 'neutral'}>
                      {row.channel === 'sms' ? t.common.sms : t.common.email}
                    </Badge>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                      {stat(t.dashboard.funnelSent, row.sent, null)}
                      {stat(t.dashboard.funnelOpened, row.opened, pct(row.opened))}
                      {stat(t.dashboard.funnelCheckout, row.checkout, pct(row.checkout))}
                      {stat(t.dashboard.funnelPaid, row.paid, pct(row.paid))}
                    </dl>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-5 py-2.5 font-medium">{t.dashboard.funnelChannel}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.dashboard.funnelSent}</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      {t.dashboard.funnelOpened}
                    </th>
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
                this says which customer opened the link and stopped — the only
                part of the funnel anyone can act on today. */}
            {activity.length ? (
              <div id="activity" className="border-t border-ink-200 scroll-mt-20">
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
          <EmptyState title={t.dashboard.emptyTitle} body={t.dashboard.emptyBody} />
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
                          {debtor.vat_number ? (
                            <span>
                              {t.debtors.vat} {debtor.vat_number}
                            </span>
                          ) : null}
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
