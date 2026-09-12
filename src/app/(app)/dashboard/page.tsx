import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardHeader, EmptyState, linkClass, Stat } from '@/components/ui';
import { DEFAULT_CURRENCY, totalsByCurrency } from '@/lib/currency';
import {
  agingBuckets,
  collectedAmounts,
  collectedThroughLefta,
  failedSendsWorthFixing,
  funnelSince,
  funnelTotals,
  startedNotPaid,
} from '@/lib/dashboard/figures';
import { displayName } from '@/lib/debtors';
import { loadScenario } from '@/lib/dunning/engine';
import { effectiveNoticeTexts } from '@/lib/dunning/template-store';
import { getDictionary, getLocale } from '@/lib/i18n';
import { athensDate, daysBetween, formatMoney } from '@/lib/money';
import { requireOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

import { CreateInvoiceForm } from '../invoices/invoice-forms';
import { Dropzone } from '../invoices/upload/dropzone';
import { AutomationSwitch } from '../settings/automation-switch';

/**
 * What a person opening this product needs, and nothing else.
 *
 * This screen had grown to eleven blocks and 868 lines. Four of the five figures
 * above the fold were the same money counted four ways — outstanding and overdue
 * printed the identical total side by side, the aging strip printed it a third
 * time, and a quarter of the tile row was spent on an SMS balance of zero on an
 * account with no SMS provider. Two hundred of those lines were a funnel table,
 * rendered twice for mobile and desktop, reporting thirty page views.
 *
 * What is left is the four things the screen is for: whether the product is
 * writing to customers on its own, how much is owed, somewhere to throw an
 * invoice, and the queue of what the automation could not decide. The funnel
 * stays, as one line, because the reading matters even when the detail does not
 * belong here. Everything removed is on /statistics — moved, not deleted.
 */

/** Totals for a tile, one figure per currency, joined rather than added. */
function money(totals: ReturnType<typeof totalsByCurrency>): string {
  if (!totals.length) return formatMoney(0);
  return totals.map((total) => formatMoney(total.cents, total.currency)).join(' · ');
}

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
  const since = funnelSince();

  // The account cadence, so a manually raised invoice can be given its terms
  // here rather than remembered and applied on a later screen.
  const org = await requireOrganization();
  const scenario = await loadScenario(org.id);
  // For the quick wording editor beside the cadence in the create form.
  const notice = await effectiveNoticeTexts(org.id, await getLocale());

  // RLS scopes every one of these to the company this session is acting for.
  const [
    { data: profile },
    { data: invoices },
    { data: debtors },
    { data: recentPayments },
    { data: recentSends },
    { data: sentComms },
    { data: failedSends },
    { count: pendingScans },
    { data: funnelEvents },
  ] = await Promise.all([
    supabase
      .from('users')
      .select('company_name, automation_enabled')
      // No filter: the policy already shows exactly the active company, and the
      // signed-in person's id is not it once they act for more than one.
      .limit(1)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select(
        'id, debtor_id, amount_cents, currency, due_date, status, paid_at, paid_amount_cents, invoice_number, series, mark, stripe_payment_intent_id, viva_transaction_id, revolut_order_id',
      )
      .in('status', ['pending', 'paid'])
      .order('due_date', { ascending: true }),
    supabase.from('debtors').select('id, name, vat_number, email, phone, muted').order('name'),
    supabase
      .from('invoices')
      .select('id, debtor_id, amount_cents, currency, paid_at, paid_amount_cents, invoice_number, series, mark')
      .eq('status', 'paid')
      .not('stripe_checkout_session_id', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(8),
    // The feed, which is about sends as much as payments: a refusal is the most
    // important thing that can happen to a reminder and it never appeared here.
    supabase
      .from('communications_log')
      .select('id, debtor_id, invoice_id, channel, status, sent_at')
      .order('sent_at', { ascending: false })
      // More than the feed shows, because skipped rows are dropped below: a run
      // that skipped eight invoices would otherwise leave the feed empty.
      .limit(24),
    supabase
      .from('communications_log')
      .select('invoice_id, channel, status, sent_at')
      .eq('status', 'sent')
      .gte('sent_at', since)
      .limit(5000),
    // Every refusal on file, not just recent ones — a customer who was never
    // told is still owed the message a year later. Narrowed to invoices that
    // are still open by `failedSendsWorthFixing`.
    supabase
      .from('communications_log')
      .select('invoice_id')
      .eq('status', 'failed')
      .limit(2000),
    supabase
      .from('invoice_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('funnel_events')
      .select('invoice_id, channel, event, occurred_at')
      .gte('occurred_at', since)
      .limit(5000),
  ]);

  const allInvoices = invoices ?? [];
  const pending = allInvoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter((i) => daysBetween(i.due_date, today) > 0);
  const stillOpen = new Set(pending.map((i) => i.id));

  // Kept apart by currency rather than added together: there is no exchange
  // rate in this product and inventing one to keep a tidy single figure is how
  // a dashboard reports money that does not exist.
  const outstandingTotals = totalsByCurrency(pending);
  const collectedTotals = totalsByCurrency(collectedAmounts(collectedThroughLefta(allInvoices)));

  // The bar inside the tile compares amounts against one another, so it is
  // scoped to one currency — the one carrying the most outstanding, which is
  // also the figure leading the tile. The rest are named in the tile's own
  // total and broken down in full on the statistics screen.
  const stripCurrency = outstandingTotals[0]?.currency ?? DEFAULT_CURRENCY;
  const stripCents = outstandingTotals[0]?.cents ?? 0;
  const buckets = agingBuckets(
    pending.filter((i) => (i.currency?.toUpperCase() || DEFAULT_CURRENCY) === stripCurrency),
    (i) => daysBetween(i.due_date, today),
    {
      notDue: t.dashboard.agingNotDue,
      late1to9: t.dashboard.agingLate(1, 9),
      late10plus: t.dashboard.agingLatePlus(10),
    },
  );

  const paidAtByInvoice = new Map(
    allInvoices
      .filter((i) => i.status === 'paid' && i.paid_at)
      .map((i) => [i.id, new Date(i.paid_at as string).getTime()]),
  );

  const performance = funnelTotals(sentComms ?? [], funnelEvents ?? [], paidAtByInvoice);
  const performanceHasData = performance.sent > 0 || (funnelEvents?.length ?? 0) > 0;

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  /** How an invoice is named wherever it is mentioned by one line of text. */
  const invoiceLabel = (invoice: {
    id: string;
    series?: string | null;
    invoice_number?: string | null;
    mark?: string | null;
  }) =>
    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
    invoice.mark ||
    invoice.id.slice(0, 8);

  const invoicesById = new Map(allInvoices.map((i) => [i.id, i]));

  // ------------------------------------------------------------- needs you
  //
  // The queue this screen did not have. Forty-five refused sends and a scan
  // waiting to be confirmed were invisible here while the page reported thirty
  // page views in a two-hundred-line table.

  const unreachable = (debtors ?? []).filter(
    (d) => !d.email && !d.phone && pending.some((i) => i.debtor_id === d.id),
  ).length;

  const needs = [
    {
      key: 'failed',
      count: failedSendsWorthFixing(failedSends ?? [], stillOpen),
      title: (n: number) => t.dashboard.needsFailed(n),
      hint: t.dashboard.needsFailedHint,
      action: t.dashboard.needsFailedAction,
      href: '/logs',
      tone: 'bg-red-50 text-red-700',
      icon: (
        <>
          <path d="M3.5 6h17v12h-17z" />
          <path d="M3.5 6.8 12 13l8.5-6.2" />
        </>
      ),
    },
    {
      key: 'scans',
      count: pendingScans ?? 0,
      title: (n: number) => t.dashboard.needsScans(n),
      hint: t.dashboard.needsScansHint,
      action: t.dashboard.needsScansAction,
      href: '/invoices/upload',
      tone: 'bg-brand-50 text-brand-700',
      icon: (
        <>
          <path d="M6 3h9l5 5v13H6z" />
          <path d="M14 3v6h6" />
          <path d="M9 14.5l2.2 2.2L16 12" />
        </>
      ),
    },
    {
      key: 'started',
      count: startedNotPaid(funnelEvents ?? [], stillOpen),
      title: (n: number) => t.dashboard.needsStarted(n),
      hint: t.dashboard.needsStartedHint,
      action: t.dashboard.needsStartedAction,
      href: '/statistics#activity',
      tone: 'bg-ink-100 text-ink-600',
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.6v4.6l3 1.8" />
        </>
      ),
    },
    {
      key: 'unreachable',
      count: unreachable,
      title: (n: number) => t.dashboard.unreachable(n),
      hint: null,
      action: t.dashboard.fixContacts,
      href: '/debtors',
      tone: 'bg-amber-50 text-amber-700',
      icon: (
        <>
          <circle cx="10" cy="8" r="3.4" />
          <path d="M4 20a6 6 0 0 1 12 0" />
          <path d="M17 8.5v3.5M17 15.3v.2" />
        </>
      ),
    },
  ].filter((item) => item.count > 0);

  // ---------------------------------------------------------- latest activity
  //
  // One feed where there were two half-stories: "recent payments" showed money
  // and never a send, and the message history showed sends on another screen
  // entirely. What happened last is one sequence.

  const feed = [
    ...(recentPayments ?? []).map((payment) => ({
      key: `paid-${payment.id}`,
      at: payment.paid_at,
      kind: 'paid' as const,
      name: (() => {
        const customer = debtorsById.get(payment.debtor_id);
        return customer ? displayName(customer) : null;
      })(),
      label: invoiceLabel(payment),
      amount: formatMoney(payment.paid_amount_cents ?? payment.amount_cents, payment.currency),
    })),
    ...(recentSends ?? [])
      // A skipped send is a decision the engine took and explained in the log;
      // it is not something that happened to a customer.
      .filter((send) => send.status === 'sent' || send.status === 'failed')
      .map((send) => {
        const invoice = send.invoice_id ? invoicesById.get(send.invoice_id) : undefined;
        const customer = debtorsById.get(send.debtor_id);

        return {
          key: `send-${send.id}`,
          at: send.sent_at,
          kind: send.status === 'failed' ? ('failed' as const) : ('sent' as const),
          name: customer ? displayName(customer) : null,
          label: invoice ? invoiceLabel(invoice) : null,
          amount: null,
        };
      }),
  ]
    .filter((entry): entry is typeof entry & { at: string } => Boolean(entry.at))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const feedTone = {
    paid: { dot: 'bg-emerald-500', text: t.dashboard.feedPaid },
    sent: { dot: 'bg-ink-300', text: t.dashboard.feedSent },
    failed: { dot: 'bg-red-500', text: t.dashboard.feedFailed },
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink-900">{t.dashboard.title}</h1>

      {/* The master switch, at the size of what it governs.
          Whether the product writes to customers on its own is the single
          biggest thing about it, so it is the first thing on the screen and it
          is switchable where it is read — the same component the settings row
          uses, so the two cannot drift into meaning different things. */}
      <Card>
        <AutomationSwitch
          enabled={Boolean(profile?.automation_enabled)}
          openInvoices={pending.length}
          hero
        />
      </Card>

      {/* One money figure, not four.
          The overdue count lives inside this tile as a clause rather than
          beside it as a second tile printing the same total; the age split is
          the bar, and the full breakdown is one click away. */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {/* Stat's own anatomy, because this is a Stat that carries a bar: the
            padding sits on the Card, not on an inner wrapper. */}
        <Card className="px-4 py-4 sm:px-5 lg:col-span-2">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t.dashboard.owed}
              </p>
              {stripCents > 0 ? (
                <Link href="/statistics" className={`text-xs ${linkClass}`}>
                  {t.dashboard.owedBreakdown}
                </Link>
              ) : null}
            </div>

            {/* Not tabular: at this size every digit as wide as a zero reads
                loose, which is why Stat leaves its own value proportional. */}
            <p className="mt-2 text-[28px] font-semibold leading-9 tracking-tight text-ink-900">
              {money(outstandingTotals)}
            </p>

            <p className="mt-1 text-xs text-ink-500">
              {pending.length === 0
                ? t.dashboard.outstandingHint(0)
                : overdue.length === pending.length
                  ? t.dashboard.owedAllOverdue(pending.length)
                  : overdue.length === 0
                    ? t.dashboard.owedNoneOverdue(pending.length)
                    : t.dashboard.owedSomeOverdue(pending.length, overdue.length)}
            </p>

            {stripCents > 0 ? (
              <>
                <div
                  className="mt-4 flex h-1.5 w-full gap-[2px]"
                  role="img"
                  aria-label={t.dashboard.aging}
                >
                  {buckets
                    .filter((bucket) => bucket.cents > 0)
                    .map((bucket) => (
                      <div
                        key={bucket.key}
                        className={`${bucket.swatch} first:rounded-l-full last:rounded-r-full`}
                        style={{
                          width: `${(bucket.cents / stripCents) * 100}%`,
                          minWidth: '8px',
                        }}
                        title={`${bucket.label}: ${formatMoney(bucket.cents, stripCurrency)}`}
                      />
                    ))}
                </div>

                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  {buckets
                    .filter((bucket) => bucket.count > 0)
                    .map((bucket) => (
                      <div key={bucket.key} className="flex items-baseline gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2 w-2 translate-y-px rounded-sm ${bucket.swatch}`}
                        />
                        <dt className="text-xs text-ink-500">{bucket.label}</dt>
                        <dd className="tabular text-xs font-medium text-ink-700">{bucket.count}</dd>
                      </div>
                    ))}
                </dl>
              </>
            ) : null}
          </div>
        </Card>

        <Stat
          label={t.dashboard.collected}
          value={money(collectedTotals)}
          hint={t.dashboard.collectedHint}
          tone="positive"
        />
      </div>

      {/* The way in.
          Raising an invoice is the act the whole product hangs off, and it was
          five blocks down. Both roads, because they are different jobs: drop
          the document and let it be read, or type one in for a customer
          already on file. */}
      <Card>
        <CardHeader title={t.dashboard.addTitle} subtitle={t.dashboard.addHint} />
        <Dropzone reviewHref="/invoices/upload" />
        <div className="border-t border-ink-100 px-5 py-4">
          <CreateInvoiceForm debtors={debtors ?? []} scenario={scenario} notice={notice} />
        </div>
      </Card>

      {/* Nothing to decide, nothing to render: an empty queue is not a card
          saying the queue is empty. */}
      {needs.length > 0 ? (
        <Card>
          <CardHeader title={t.dashboard.needsTitle} subtitle={t.dashboard.needsHint} />
          <ul className="divide-y divide-ink-100">
            {needs.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5"
              >
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-[18px] w-[18px]"
                    aria-hidden
                  >
                    {item.icon}
                  </svg>
                </span>

                <div className="min-w-0 flex-grow basis-48">
                  <p className="text-sm font-semibold text-ink-900">{item.title(item.count)}</p>
                  {item.hint ? <p className="mt-0.5 text-xs text-ink-500">{item.hint}</p> : null}
                </div>

                <Link
                  href={item.href}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-ink-300 px-3.5 text-sm font-medium text-ink-700 transition hover:bg-ink-50 sm:min-h-9"
                >
                  {item.action}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* The funnel as one line. The per-channel table and the who-opened-what
          list are on the statistics screen; what belongs here is whether the
          chasing is working at all. */}
      <Card>
        <CardHeader
          title={t.dashboard.funnel}
          subtitle={t.dashboard.funnelStripHint}
          action={
            <Link href="/statistics" className={`text-sm ${linkClass}`}>
              {t.dashboard.funnelDetails}
            </Link>
          }
        />
        {!performanceHasData ? (
          <EmptyState title={t.dashboard.funnelEmptyTitle} body={t.dashboard.funnelEmptyBody} />
        ) : (
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:px-5">
            {[
              { label: t.dashboard.funnelSent, value: performance.sent, share: null as string | null },
              {
                label: t.dashboard.funnelOpened,
                value: performance.opened,
                share:
                  performance.sent > 0
                    ? `${Math.round((performance.opened / performance.sent) * 100)}%`
                    : null,
              },
              {
                label: t.dashboard.funnelCheckout,
                value: performance.checkout,
                share:
                  performance.sent > 0
                    ? `${Math.round((performance.checkout / performance.sent) * 100)}%`
                    : null,
              },
              {
                label: t.dashboard.funnelPaid,
                value: performance.paid,
                share:
                  performance.sent > 0
                    ? `${Math.round((performance.paid / performance.sent) * 100)}%`
                    : null,
              },
            ].map((cell) => (
              <div key={cell.label}>
                <dt className="text-xs text-ink-500">{cell.label}</dt>
                <dd className="tabular mt-1 text-xl font-semibold leading-7 text-ink-900">
                  {cell.value}
                  {cell.share !== null ? (
                    <span className="ml-1.5 text-xs font-normal text-ink-400">{cell.share}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t.dashboard.feedTitle}
          subtitle={t.dashboard.feedHint}
          action={
            <Link href="/logs" className={`text-sm ${linkClass}`}>
              {t.dashboard.feedAll}
            </Link>
          }
        />

        {feed.length === 0 ? (
          <EmptyState title={t.dashboard.feedEmptyTitle} body={t.dashboard.feedEmptyBody} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {feed.map((entry) => (
              <li key={entry.key} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 inline-block h-[7px] w-[7px] shrink-0 rounded-full ${feedTone[entry.kind].dot}`}
                />
                <div className="min-w-0 flex-grow">
                  <p className="truncate text-sm text-ink-800">
                    {feedTone[entry.kind].text}
                    {' — '}
                    {entry.name ?? <span className="italic text-ink-400">{t.debtors.nameMissing}</span>}
                  </p>
                  <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                    {[entry.label, new Date(entry.at).toLocaleString(t.dateTimeTag)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {entry.amount ? (
                  <span className="tabular shrink-0 text-sm font-medium text-emerald-700">
                    {entry.amount}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
