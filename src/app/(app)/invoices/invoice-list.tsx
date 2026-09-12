import Link from 'next/link';

import { DeleteButton } from '@/components/delete-button';
import { Badge, subtleLinkClass } from '@/components/ui';
import type { aging } from '@/lib/aging';
import { automationPaused } from '@/lib/dunning/engine';
import type { workflowStatus } from '@/lib/dunning/status';
import type { Dictionary } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/money';
import { settlementMethod } from '@/lib/payments/settlement';
import type { InvoiceRow } from '@/types/database';

import { deleteInvoice, markInvoicePaid } from './actions';
import { CopyPayLink, DueDateButton, InvoiceAutomationSwitch, RemindButton } from './invoice-forms';
import { SelectAll } from './select-all';

/**
 * The invoice list, in its two layouts.
 *
 * One list of documents rendered twice — a stack of cards below `md`, a table
 * above it — because a table of nine columns is unreadable on a phone and a
 * stack of cards wastes a desktop. Both are in the document at once with one
 * hidden by CSS, which is worth knowing about: it is why a "select all" once
 * submitted every id twice and a batch of 140 invoices reported itself as 282.
 *
 * They live here rather than in the page because between them they were 410 of
 * its 903 lines, and the page's actual job — reading the filters, fetching the
 * rows, deciding what is selectable — was buried under markup. Everything they
 * derive is derived once by the page and handed over, so the two layouts cannot
 * disagree about what a row says.
 */

/**
 * The customer, as much of them as the list query asks for.
 *
 * Narrower than `DebtorRow` on purpose: the list selects three columns, and
 * declaring the whole row here would let a layout reach for an email address
 * that was never fetched.
 */
export interface InvoiceListDebtor {
  id: string;
  name: string;
  vat_number: string | null;
}

/** Everything a row needs, derived once by the page. */
export interface InvoiceView {
  status: ReturnType<typeof workflowStatus>;
  number: string | null;
  label: string;
  debtor: InvoiceListDebtor | undefined;
  customer: string | null;
  age: ReturnType<typeof aging>;
}

export interface InvoiceListProps {
  t: Dictionary;
  visible: InvoiceRow[];
  view: (invoice: InvoiceRow) => InvoiceView;
  /** Which invoices have a scan behind them. Nullable, as the column is. */
  withDocument: Set<string | null>;
  /** The kind of report a customer filed and nobody has reviewed yet, by invoice. */
  reportByInvoice: Map<string, string>;
  /** Invoices a bank credit settled, so the row can say how. */
  bankSettled: Set<string | null>;
  showBulk: boolean;
  showSettled: boolean;
  methodLabel: Record<string, string>;
  sort: string;
  descending: boolean;
  sortHref: (key: string) => string;
}

/**
 * The phone layout: one card per document.
 *
 * Takes the whole prop bundle but destructures less of it: sorting is a row of
 * links above this list rather than clickable headings, so the three sorting
 * props are the table's alone.
 */
export function InvoiceCards({
  t,
  visible,
  view,
  withDocument,
  reportByInvoice,
  bankSettled,
  showBulk,
  showSettled,
  methodLabel,
}: InvoiceListProps) {
  return (
      <ul className="divide-y divide-ink-100 md:hidden">
        {visible.map((invoice) => {
          const { status, number, label, debtor, customer, age } = view(invoice);
          const selectable = showBulk && invoice.status === 'pending';

          return (
            <li key={invoice.id} className="px-4 py-4">
              <div className="flex items-start gap-3">
                {selectable ? (
                  <input
                    type="checkbox"
                    form="bulk"
                    name="ids"
                    value={invoice.id}
                    aria-label={label}
                    className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {debtor ? (
                        <Link
                          href={`/debtors/${debtor.id}`}
                          className="block truncate font-medium text-ink-900 underline-offset-2 hover:underline"
                        >
                          {customer ?? t.debtors.nameMissing}
                        </Link>
                      ) : (
                        <span className="block truncate italic text-ink-400">
                          {t.debtors.nameMissing}
                        </span>
                      )}
                      {debtor?.vat_number ? (
                        <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                          <span className="text-ink-400">{t.debtors.vat}</span>{' '}
                          {debtor.vat_number}
                        </p>
                      ) : null}
                      {/* The number opens the invoice rather than the scan
                          behind it: the scan is one of the things the
                          invoice shows, along with what was sent and what
                          happens next. */}
                      <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="underline decoration-ink-300 underline-offset-2"
                        >
                          {number ?? t.invoices.noNumber}
                        </Link>
                        {invoice.mark ? (
                          <>
                            <span className="px-1.5 text-ink-300">·</span>
                            <span className="text-ink-400">{t.invoices.markLabel}</span>{' '}
                            {invoice.mark}
                          </>
                        ) : null}
                        {withDocument.has(invoice.id) ? (
                          <>
                            <span className="px-1.5 text-ink-300">·</span>
                            <a
                              href={`/api/invoices/${invoice.id}/document`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-ink-300 underline-offset-2"
                            >
                              {t.invoices.openDocument}
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>

                    <span className="tabular shrink-0 text-base font-semibold text-ink-900">
                      {formatMoney(invoice.amount_cents, invoice.currency)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {(() => {
                      if (!showSettled) return null;
                      const method = settlementMethod(invoice, {
                        settledByBank: bankSettled.has(invoice.id),
                      });
                      if (!method) return null;
                      return (
                        <Badge tone={method.startsWith('card') ? 'info' : 'neutral'}>
                          <span className="whitespace-nowrap">{methodLabel[method]}</span>
                        </Badge>
                      );
                    })()}
                    {age ? <Badge tone={age.tone}>{age.label}</Badge> : null}
                    {reportByInvoice.has(invoice.id) ? (
                      <Badge
                        tone={
                          reportByInvoice.get(invoice.id) === 'paid_claim' ? 'info' : 'warning'
                        }
                      >
                        {reportByInvoice.get(invoice.id) === 'paid_claim'
                          ? t.reports.kindPaid
                          : t.reports.kindDispute}
                      </Badge>
                    ) : null}
                  </div>

                  {showSettled && invoice.paid_at ? (
                    <p className="tabular mt-2 text-xs text-ink-500">
                      {t.invoices.colPaid}:{' '}
                      {new Date(invoice.paid_at).toLocaleString(t.dateTimeTag)}
                    </p>
                  ) : null}

                  <p className="tabular mt-2 text-xs text-ink-500">
                    {t.invoices.colIssue}: {formatDate(invoice.issue_date)}
                  </p>

                  <p className="tabular mt-1 text-xs text-ink-500">
                    {t.invoices.colDue}:{' '}
                    <DueDateButton
                      invoiceId={invoice.id}
                      dueDate={invoice.due_date}
                      display={formatDate(invoice.due_date)}
                    />
                  </p>

                  {/* Chasing only makes sense for an open invoice; deleting one
                      applies to any row, so the wrapper is no longer gated. */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {invoice.status === 'pending' ? (
                      <>
                        <RemindButton invoiceId={invoice.id} label={label} />
                        <CopyPayLink code={invoice.short_code ?? invoice.pay_token} />
                        {/* The same control the table row has. Settling an
                            invoice is the one thing people do standing in
                            front of the customer, so the phone is where it
                            is needed most. */}
                        <form action={markInvoicePaid}>
                          <input type="hidden" name="id" value={invoice.id} />
                          <button
                            type="submit"
                            className={`inline-flex min-h-11 items-center text-sm sm:min-h-0 ${subtleLinkClass}`}
                            title={t.invoices.markPaidHint}
                          >
                            {t.invoices.markPaid}
                          </button>
                        </form>
                        <label className="flex items-center gap-2 text-sm text-ink-600">
                          <InvoiceAutomationSwitch
                            invoiceId={invoice.id}
                            enabled={!automationPaused(invoice)}
                            label={label}
                          />
                          {t.invoices.colAutomation}
                        </label>
                      </>
                    ) : null}
                    <DeleteButton
                      action={deleteInvoice}
                      id={invoice.id}
                      trigger={t.common.delete}
                      title={t.invoices.deleteTitle}
                      body={t.invoices.deleteBody(label)}
                      warning={invoice.status === 'paid' ? t.invoices.deletePaidWarning : undefined}
                      confirmLabel={t.common.delete}
                    />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
  );
}

/** The desktop layout, with sortable headings. */
export function InvoiceTable({
  t,
  visible,
  view,
  withDocument,
  reportByInvoice,
  bankSettled,
  showBulk,
  showSettled,
  methodLabel,
  sort,
  descending,
  sortHref,
}: InvoiceListProps) {
  return (
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
              {showBulk ? (
                <th className="w-10 px-5 py-2.5">
                  <SelectAll form="bulk" />
                </th>
              ) : null}
              <th className="px-5 py-2.5 font-medium">{t.invoices.colInvoice}</th>
              <th className="px-5 py-2.5 font-medium">
                <a href={sortHref('customer')} className="hover:text-ink-800">
                  {t.invoices.colCustomer}
                  {sort === 'customer' ? (descending ? ' ↓' : ' ↑') : ''}
                </a>
              </th>
              <th className="px-5 py-2.5 text-right font-medium">
                <a href={sortHref('amount')} className="hover:text-ink-800">
                  {t.invoices.colAmount}
                  {sort === 'amount' ? (descending ? ' ↓' : ' ↑') : ''}
                </a>
              </th>
              <th className="px-5 py-2.5 font-medium">
                <a href={sortHref('issued')} className="hover:text-ink-800">
                  {t.invoices.colIssue}
                  {sort === 'issued' ? (descending ? ' ↓' : ' ↑') : ''}
                </a>
              </th>
              <th className="px-5 py-2.5 font-medium">
                <a href={sortHref('due')} className="hover:text-ink-800">
                  {t.invoices.colDue}
                  {sort === 'due' ? (descending ? ' ↓' : ' ↑') : ''}
                </a>
              </th>
              <th className="px-5 py-2.5 font-medium">{t.invoices.colAging}</th>
              <th className="px-5 py-2.5 font-medium">{t.invoices.colStatus}</th>
              <th className="px-5 py-2.5 text-center font-medium">
                {t.invoices.colAutomation}
              </th>
              {showSettled ? (
                <th className="px-5 py-2.5 font-medium">{t.invoices.colPaid}</th>
              ) : null}
              <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((invoice) => {
              const { status, number, label, debtor, customer, age } = view(invoice);

              return (
                <tr key={invoice.id} className="border-b border-ink-100 last:border-0">
                  {showBulk ? (
                    <td className="px-5 py-3">
                      {/* Only an open invoice can be reminded about, so a paid
                          row offers nothing to select. */}
                      {invoice.status === 'pending' ? (
                        <input
                          type="checkbox"
                          form="bulk"
                          name="ids"
                          value={invoice.id}
                          aria-label={label}
                          className="h-5 w-5 cursor-pointer rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-5 py-3">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className={`font-medium underline-offset-2 hover:underline ${
                        number ? 'text-ink-900' : 'italic text-ink-400'
                      }`}
                    >
                      {number ?? t.invoices.noNumber}
                    </Link>
                    <div className="tabular mt-0.5 text-xs text-ink-500">
                      {invoice.mark ? (
                        <>
                          <span className="text-ink-400">{t.invoices.markLabel}</span>{' '}
                          {invoice.mark}
                        </>
                      ) : (
                        t.invoices.manualSource
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {/* Straight through to the customer's profile: from a row
                        that is chasing them, the next question is almost always
                        who they are and what else they owe. A debtor with no
                        name yet links too — the profile is where it gets fixed. */}
                    {debtor ? (
                      <Link href={`/debtors/${debtor.id}`} className={`block ${subtleLinkClass}`}>
                        {customer ?? (
                          <span className="italic text-ink-400">{t.debtors.nameMissing}</span>
                        )}
                      </Link>
                    ) : (
                      <div className="italic text-ink-400">{t.debtors.nameMissing}</div>
                    )}
                    {debtor?.vat_number ? (
                      <div className="tabular mt-0.5 text-xs text-ink-500">
                        <span className="text-ink-400">{t.debtors.vat}</span>{' '}
                        {debtor.vat_number}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular px-5 py-3 text-right font-medium text-ink-900">
                    {formatMoney(invoice.amount_cents, invoice.currency)}
                  </td>
                  <td className="tabular px-5 py-3 text-ink-500">
                    {formatDate(invoice.issue_date)}
                  </td>
                  <td className="px-5 py-3 text-ink-600">
                    <DueDateButton
                      invoiceId={invoice.id}
                      dueDate={invoice.due_date}
                      display={formatDate(invoice.due_date)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    {age ? (
                      <Badge tone={age.tone}>{age.label}</Badge>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {/* The second badge — a customer's "I already paid" —
                        may drop to its own line; the first one may not. */}
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {reportByInvoice.has(invoice.id) ? (
                        <Badge
                          tone={
                            reportByInvoice.get(invoice.id) === 'paid_claim'
                              ? 'info'
                              : 'warning'
                          }
                        >
                          {reportByInvoice.get(invoice.id) === 'paid_claim'
                            ? t.reports.kindPaid
                            : t.reports.kindDispute}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    {/* Only where it means something. A settled invoice is
                        out of the scenario whatever this said, and a switch
                        sitting off against it would read as a decision
                        somebody made. */}
                    {invoice.status === 'pending' ? (
                      <InvoiceAutomationSwitch
                        invoiceId={invoice.id}
                        enabled={!automationPaused(invoice)}
                        label={label}
                      />
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  {showSettled ? (
                    <td className="px-5 py-3">
                      {(() => {
                        const method = settlementMethod(invoice, {
                          settledByBank: bankSettled.has(invoice.id),
                        });
                        if (!method) return <span className="text-ink-400">—</span>;
                        return (
                          <>
                            <div className="tabular text-ink-600">
                              {invoice.paid_at
                                ? new Date(invoice.paid_at).toLocaleString(t.dateTimeTag)
                                : '—'}
                            </div>
                            <div className="mt-1">
                              <Badge
                                tone={method.startsWith('card') ? 'info' : 'neutral'}
                              >
                                <span className="whitespace-nowrap">{methodLabel[method]}</span>
                              </Badge>
                            </div>
                          </>
                        );
                      })()}
                    </td>
                  ) : null}
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {withDocument.has(invoice.id) ? (
                        <a
                          href={`/api/invoices/${invoice.id}/document`}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-sm ${subtleLinkClass}`}
                        >
                          {t.invoices.openDocument}
                        </a>
                      ) : null}
                      {invoice.status === 'pending' ? (
                        <>
                          <RemindButton invoiceId={invoice.id} label={label} />
                          <CopyPayLink code={invoice.short_code ?? invoice.pay_token} />
                          <form action={markInvoicePaid}>
                            <input type="hidden" name="id" value={invoice.id} />
                            <button
                              type="submit"
                              className={`text-sm ${subtleLinkClass}`}
                              title={t.invoices.markPaidHint}
                            >
                              {t.invoices.markPaid}
                            </button>
                          </form>
                        </>
                      ) : null}
                      <DeleteButton
                        action={deleteInvoice}
                        id={invoice.id}
                        trigger={t.common.delete}
                        title={t.invoices.deleteTitle}
                        body={t.invoices.deleteBody(label)}
                        warning={invoice.status === 'paid' ? t.invoices.deletePaidWarning : undefined}
                        confirmLabel={t.common.delete}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}
