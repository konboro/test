import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Stat,
  linkClass,
  subtleLinkClass,
} from '@/components/ui';
import { displayName } from '@/lib/debtors';
import { getDictionary } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { BankTransactionRow } from '@/types/database';

import { confirmMatch, dismissMatch, reopenTransaction } from './actions';

export async function generateMetadata() {
  return { title: (await getDictionary()).bank.title };
}
export const dynamic = 'force-dynamic';

const FILTERS = ['all', 'card', 'review', 'unmatched', 'settled', 'dismissed'] as const;
type Filter = (typeof FILTERS)[number];

const STATE_TONE: Record<BankTransactionRow['state'], 'positive' | 'warning' | 'neutral'> = {
  settled: 'positive',
  review: 'warning',
  unmatched: 'neutral',
  dismissed: 'neutral',
};

/**
 * Money arriving, however it arrived.
 *
 * Transfers read from the bank and card payments taken through our own links are
 * the same event to the person reading this page — an invoice got paid — and
 * splitting them across two screens means reconciling by memory. They are
 * deliberately not merged into one row shape though: a card payment already
 * knows which invoice it settled, while a transfer is a fact about money that
 * may or may not explain anything yet.
 */
type Entry =
  | { kind: 'transfer'; id: string; date: string; amountCents: number; row: BankTransactionRow }
  | {
      kind: 'card';
      id: string;
      date: string;
      amountCents: number;
      currency: string;
      provider: 'stripe' | 'viva';
      invoiceLabel: string;
      debtorName: string | null;
    };

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: raw } = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as Filter)
    : 'all';

  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS scopes all three to this tenant.
  const [{ data: rows }, { data: invoices }, { data: debtors }] = await Promise.all([
    supabase
      .from('bank_transactions')
      .select('*')
      .order('booked_on', { ascending: false })
      .limit(500),
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, series, mark, amount_cents, currency, status, issue_date, debtor_id, paid_at, paid_amount_cents, stripe_payment_intent_id, viva_transaction_id',
      ),
    supabase.from('debtors').select('id, name, vat_number'),
  ]);

  const transfers = rows ?? [];
  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));
  const debtorById = new Map((debtors ?? []).map((d) => [d.id, d]));

  const label = (id: string | null) => {
    if (!id) return null;
    const invoice = invoiceById.get(id);
    if (!invoice) return null;
    return (
      [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
      invoice.mark ||
      invoice.id.slice(0, 8)
    );
  };

  /**
   * Card payments taken through our links.
   *
   * Keyed on the provider's own reference rather than on `status`, because an
   * invoice can be paid in ways this page must not claim credit for — recorded
   * by hand, or settled in Elorus. Both references are written only after the
   * payment was read back from the provider, so their presence is evidence the
   * money actually moved through us.
   */
  const cardPayments: Entry[] = (invoices ?? [])
    .filter((i) => i.stripe_payment_intent_id || i.viva_transaction_id)
    .map((i) => {
      const debtor = debtorById.get(i.debtor_id);

      return {
        kind: 'card' as const,
        id: `card:${i.id}`,
        date: (i.paid_at ?? `${i.issue_date}T00:00:00Z`).slice(0, 10),
        amountCents: i.paid_amount_cents ?? i.amount_cents,
        currency: i.currency,
        provider: i.viva_transaction_id ? ('viva' as const) : ('stripe' as const),
        invoiceLabel: label(i.id) ?? i.id.slice(0, 8),
        debtorName: debtor ? displayName(debtor) : null,
      };
    });

  const transferEntries: Entry[] = transfers.map((row) => ({
    kind: 'transfer' as const,
    id: row.id,
    date: row.booked_on,
    amountCents: row.amount_cents,
    row,
  }));

  const all: Entry[] = [...transferEntries, ...cardPayments].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  const candidatesFor = (row: BankTransactionRow) =>
    (invoices ?? []).filter(
      (i) =>
        i.status === 'pending' &&
        i.amount_cents === row.amount_cents &&
        i.issue_date <= row.booked_on &&
        !(row.rejected_invoice_ids ?? []).includes(i.id),
    );

  const shown = all.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'card') return entry.kind === 'card';
    // A card payment is settled by definition; it never sits in a queue.
    if (filter === 'settled') return entry.kind === 'card' || entry.row.state === 'settled';
    return entry.kind === 'transfer' && entry.row.state === filter;
  });

  const totals = {
    received: all.reduce((sum, e) => sum + e.amountCents, 0),
    card: cardPayments.reduce((sum, e) => sum + e.amountCents, 0),
    review: transfers.filter((r) => r.state === 'review').length,
  };

  const noPayerDisclosed =
    transfers.length > 0 && transfers.every((r) => !r.counterparty_name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.bank.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.bank.subtitle}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t.bank.totalCredited}
          value={formatMoney(totals.received)}
          hint={t.bank.totalHint(all.length)}
        />
        <Stat
          label={t.bank.viaLinks}
          value={formatMoney(totals.card)}
          tone="positive"
          hint={t.bank.viaLinksHint(cardPayments.length)}
        />
        <Stat
          label={t.bank.needsReview}
          value={String(totals.review)}
          tone={totals.review ? 'warning' : 'default'}
          hint={t.bank.needsReviewHint}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((key) => (
          <a
            key={key}
            href={`/bank?filter=${key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filter === key
                ? 'bg-ink-900 text-white'
                : 'border border-ink-300 bg-white text-ink-600 hover:bg-ink-50'
            }`}
          >
            {t.bank.filters[key]}
          </a>
        ))}
      </div>

      <Card>
        <CardHeader title={t.bank.count(shown.length)} subtitle={t.bank.readOnly} />

        {noPayerDisclosed ? (
          <p className="border-b border-ink-100 bg-ink-50 px-5 py-2.5 text-xs leading-relaxed text-ink-600">
            {t.bank.noPayerNote}
          </p>
        ) : null}

        {!shown.length ? (
          <EmptyState title={t.bank.emptyTitle} body={t.bank.emptyBody} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {shown.map((entry) =>
              entry.kind === 'card' ? (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular text-sm font-semibold text-ink-900">
                          {formatMoney(entry.amountCents, entry.currency)}
                        </span>
                        {/* How it was paid, said outright rather than inferred
                            from which fields happen to be filled in. */}
                        <Badge tone="info">{t.bank.channels[entry.provider]}</Badge>
                        <Badge tone="positive">{t.bank.states.settled}</Badge>
                      </div>

                      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-ink-400">
                            {t.bank.colDate}
                          </dt>
                          <dd className="tabular truncate text-sm text-ink-800">
                            {formatDate(entry.date)}
                          </dd>
                        </div>
                        <div className="min-w-0 sm:col-span-2">
                          <dt className="text-xs uppercase tracking-wide text-ink-400">
                            {t.bank.colPayer}
                          </dt>
                          <dd
                            className={`truncate text-sm ${entry.debtorName ? 'text-ink-800' : 'text-ink-400'}`}
                          >
                            {entry.debtorName ?? '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs uppercase tracking-wide text-ink-400">
                        {t.bank.colInvoice}
                      </p>
                      <Link href="/invoices" className={`text-sm ${linkClass}`}>
                        {entry.invoiceLabel}
                      </Link>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={entry.id} className="px-5 py-4">
                  <TransferRow
                    row={entry.row}
                    t={t}
                    matched={label(entry.row.matched_invoice_id)}
                    candidates={
                      entry.row.state === 'review'
                        ? candidatesFor(entry.row).map((i) => ({
                            id: i.id,
                            label: label(i.id) ?? i.id.slice(0, 8),
                            debtorName: (() => {
                              const d = debtorById.get(i.debtor_id);
                              return d ? displayName(d) : null;
                            })(),
                          }))
                        : []
                    }
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TransferRow({
  row,
  t,
  matched,
  candidates,
}: {
  row: BankTransactionRow;
  t: Awaited<ReturnType<typeof getDictionary>>;
  matched: string | null;
  candidates: Array<{ id: string; label: string; debtorName: string | null }>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-sm font-semibold text-ink-900">
              {formatMoney(row.amount_cents, row.currency)}
            </span>
            <Badge tone="neutral">{t.bank.channels.transfer}</Badge>
            <Badge tone={STATE_TONE[row.state]}>{t.bank.states[row.state]}</Badge>
            {row.match_signals.map((signal) => (
              <Badge key={signal} tone="info">
                {t.bank.signals[signal as 'reference' | 'name' | 'iban'] ?? signal}
              </Badge>
            ))}
          </div>

          {/* Reference first, payer only when there is one. Several banks —
              Eurobank among them — disclose no counterparty on an incoming
              transfer, and a column of dashes on every row buries the one field
              that does identify the payment. */}
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-ink-400">{t.bank.colDate}</dt>
              <dd className="tabular truncate text-sm text-ink-800">{formatDate(row.booked_on)}</dd>
            </div>

            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-ink-400">
                {t.bank.colReference}
              </dt>
              <dd className={`break-words text-sm ${row.remittance ? 'text-ink-800' : 'text-ink-400'}`}>
                {row.remittance ?? '—'}
              </dd>
            </div>

            {row.counterparty_name ? (
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-ink-400">{t.bank.colPayer}</dt>
                <dd className="truncate text-sm text-ink-800">{row.counterparty_name}</dd>
              </div>
            ) : null}

            {row.counterparty_iban ? (
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-ink-400">{t.bank.colIban}</dt>
                <dd className="tabular truncate text-sm text-ink-800">{row.counterparty_iban}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="shrink-0 text-right">
          {matched ? (
            <>
              <p className="text-xs uppercase tracking-wide text-ink-400">{t.bank.colInvoice}</p>
              <Link href="/invoices" className={`text-sm ${linkClass}`}>
                {matched}
              </Link>
            </>
          ) : null}

          {row.state === 'dismissed' ? (
            <form action={reopenTransaction} className="mt-1">
              <input type="hidden" name="transaction_id" value={row.id} />
              <button type="submit" className={`inline-flex min-h-11 items-center text-sm sm:min-h-0 sm:text-xs ${subtleLinkClass}`}>
                {t.bank.reopen}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {row.state === 'review' ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-amber-900">{t.bank.reviewHint}</p>

          {candidates.length ? (
            <ul className="mt-2 space-y-1.5">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm text-ink-800">
                    <span className="font-medium">{candidate.label}</span>
                    {candidate.debtorName ? (
                      <span className="text-ink-500"> · {candidate.debtorName}</span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4">
                    <form action={confirmMatch}>
                      <input type="hidden" name="transaction_id" value={row.id} />
                      <input type="hidden" name="invoice_id" value={candidate.id} />
                      <button type="submit" className={`inline-flex min-h-11 items-center text-sm sm:min-h-0 sm:text-xs ${linkClass}`}>
                        {t.bank.confirm}
                      </button>
                    </form>
                    <form action={dismissMatch}>
                      <input type="hidden" name="transaction_id" value={row.id} />
                      <input type="hidden" name="invoice_id" value={candidate.id} />
                      <button type="submit" className={`inline-flex min-h-11 items-center text-sm sm:min-h-0 sm:text-xs ${subtleLinkClass}`}>
                        {t.bank.reject}
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-amber-800">{t.bank.noCandidates}</p>
          )}

          <form action={dismissMatch} className="mt-2">
            <input type="hidden" name="transaction_id" value={row.id} />
            <button type="submit" className={`inline-flex min-h-11 items-center text-sm sm:min-h-0 sm:text-xs ${subtleLinkClass}`}>
              {t.bank.dismissAll}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
