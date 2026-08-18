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

const FILTERS = ['all', 'review', 'unmatched', 'settled', 'dismissed'] as const;
type Filter = (typeof FILTERS)[number];

const STATE_TONE: Record<BankTransactionRow['state'], 'positive' | 'warning' | 'neutral'> = {
  settled: 'positive',
  review: 'warning',
  unmatched: 'neutral',
  dismissed: 'neutral',
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
      .select('id, invoice_number, series, mark, amount_cents, status, issue_date, debtor_id'),
    supabase.from('debtors').select('id, name, vat_number'),
  ]);

  const all = rows ?? [];
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
   * Open invoices this credit could plausibly settle.
   *
   * Recomputed here rather than read from a stored proposal: a proposal made
   * last night goes stale the moment the invoice is paid another way, and the
   * operator would be offered a document that is no longer open.
   */
  const candidatesFor = (row: BankTransactionRow) =>
    (invoices ?? []).filter(
      (i) =>
        i.status === 'pending' &&
        i.amount_cents === row.amount_cents &&
        i.issue_date <= row.booked_on &&
        !(row.rejected_invoice_ids ?? []).includes(i.id),
    );

  const shown = filter === 'all' ? all : all.filter((r) => r.state === filter);

  // Not "this one has no payer" but "this bank never sends one" — true only when
  // it holds for the whole statement.
  const noPayerDisclosed = all.length > 0 && all.every((r) => !r.counterparty_name);

  const totals = {
    credited: all.reduce((sum, r) => sum + r.amount_cents, 0),
    settled: all.filter((r) => r.state === 'settled').length,
    review: all.filter((r) => r.state === 'review').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.bank.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.bank.subtitle}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t.bank.totalCredited}
          value={formatMoney(totals.credited)}
          hint={t.bank.totalHint(all.length)}
        />
        <Stat
          label={t.bank.autoSettled}
          value={String(totals.settled)}
          tone="positive"
          hint={t.bank.autoSettledHint}
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

        {/* Said once, not implied by a dash on every row. Some banks disclose no
            counterparty on an incoming transfer, and an operator looking for a
            payer deserves to know that rather than assume the panel lost it. */}
        {noPayerDisclosed ? (
          <p className="border-b border-ink-100 bg-ink-50 px-5 py-2.5 text-xs leading-relaxed text-ink-600">
            {t.bank.noPayerNote}
          </p>
        ) : null}

        {!shown.length ? (
          <EmptyState title={t.bank.emptyTitle} body={t.bank.emptyBody} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {shown.map((row) => {
              const matched = label(row.matched_invoice_id);
              const candidates = row.state === 'review' ? candidatesFor(row) : [];

              return (
                <li key={row.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular text-sm font-semibold text-ink-900">
                          {formatMoney(row.amount_cents, row.currency)}
                        </span>
                        <Badge tone={STATE_TONE[row.state]}>{t.bank.states[row.state]}</Badge>
                        {row.match_signals.map((signal) => (
                          <Badge key={signal} tone="info">
                            {t.bank.signals[signal as 'reference' | 'name' | 'iban'] ?? signal}
                          </Badge>
                        ))}
                      </div>

                      {/* Reference first, payer only when there is one. Several
                          banks — Eurobank among them — disclose no counterparty
                          on an incoming transfer, and a column of dashes on
                          every row buries the one field that does identify the
                          payment. */}
                      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                        <div className="min-w-0">
                          <dt className="text-xs uppercase tracking-wide text-ink-400">
                            {t.bank.colDate}
                          </dt>
                          <dd className="tabular truncate text-sm text-ink-800">
                            {formatDate(row.booked_on)}
                          </dd>
                        </div>

                        <div className="min-w-0 sm:col-span-2">
                          <dt className="text-xs uppercase tracking-wide text-ink-400">
                            {t.bank.colReference}
                          </dt>
                          <dd
                            className={`break-words text-sm ${row.remittance ? 'text-ink-800' : 'text-ink-400'}`}
                          >
                            {row.remittance ?? '—'}
                          </dd>
                        </div>

                        {row.counterparty_name ? (
                          <div className="min-w-0">
                            <dt className="text-xs uppercase tracking-wide text-ink-400">
                              {t.bank.colPayer}
                            </dt>
                            <dd className="truncate text-sm text-ink-800">
                              {row.counterparty_name}
                            </dd>
                          </div>
                        ) : null}

                        {row.counterparty_iban ? (
                          <div className="min-w-0">
                            <dt className="text-xs uppercase tracking-wide text-ink-400">
                              {t.bank.colIban}
                            </dt>
                            <dd className="tabular truncate text-sm text-ink-800">
                              {row.counterparty_iban}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>

                    <div className="shrink-0 text-right">
                      {matched ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-ink-400">
                            {t.bank.colInvoice}
                          </p>
                          <Link href="/invoices" className={`text-sm ${linkClass}`}>
                            {matched}
                          </Link>
                        </>
                      ) : null}

                      {row.state === 'dismissed' ? (
                        <form action={reopenTransaction} className="mt-1">
                          <input type="hidden" name="transaction_id" value={row.id} />
                          <button type="submit" className={`text-xs ${subtleLinkClass}`}>
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
                          {candidates.map((invoice) => {
                            const debtor = debtorById.get(invoice.debtor_id);
                            const name = debtor ? displayName(debtor) : null;

                            return (
                              <li
                                key={invoice.id}
                                className="flex flex-wrap items-center justify-between gap-2"
                              >
                                <span className="min-w-0 text-sm text-ink-800">
                                  <span className="font-medium">{label(invoice.id)}</span>
                                  {name ? <span className="text-ink-500"> · {name}</span> : null}
                                </span>
                                <span className="flex gap-3">
                                  <form action={confirmMatch}>
                                    <input type="hidden" name="transaction_id" value={row.id} />
                                    <input type="hidden" name="invoice_id" value={invoice.id} />
                                    <button type="submit" className={`text-xs ${linkClass}`}>
                                      {t.bank.confirm}
                                    </button>
                                  </form>
                                  <form action={dismissMatch}>
                                    <input type="hidden" name="transaction_id" value={row.id} />
                                    <input type="hidden" name="invoice_id" value={invoice.id} />
                                    <button type="submit" className={`text-xs ${subtleLinkClass}`}>
                                      {t.bank.reject}
                                    </button>
                                  </form>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-1.5 text-xs text-amber-800">{t.bank.noCandidates}</p>
                      )}

                      <form action={dismissMatch} className="mt-2">
                        <input type="hidden" name="transaction_id" value={row.id} />
                        <button type="submit" className={`text-xs ${subtleLinkClass}`}>
                          {t.bank.dismissAll}
                        </button>
                      </form>
                    </div>
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
