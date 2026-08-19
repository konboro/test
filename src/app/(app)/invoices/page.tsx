import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, subtleLinkClass } from '@/components/ui';
import { aging } from '@/lib/aging';
import { displayName } from '@/lib/debtors';
import { workflowStatus } from '@/lib/dunning/status';
import { REMINDER_CHOICES } from '@/lib/dunning/templates';
import { getDictionary } from '@/lib/i18n';
import { contactLimitsDisabled } from '@/lib/limits';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { settlementMethod } from '@/lib/payments/settlement';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import {
  markInvoicePaid,
  runScenarioForSelected,
  sendBulkReminder,
  toggleInvoiceAutomation,
} from './actions';
import { CopyPayLink, CreateInvoiceForm, DueDateButton, RemindButton } from './invoice-forms';
import { BulkActions } from './bulk-actions';
import { SelectAll } from './select-all';

export async function generateMetadata() {
  return { title: (await getDictionary()).invoices.title };
}
export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['pending', 'paid', 'all'] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    sort?: string;
    dir?: string;
    q?: string;
    bulk?: string;
    sent?: string;
    limited?: string;
    skipped?: string;
    failed?: string;
    notDue?: string;
    paused?: string;
    left?: string;
  }>;
}) {
  const params = await searchParams;
  const { filter = 'pending', sort = 'due', dir = 'asc', q = '' } = params;
  const descending = dir === 'desc';
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Customer is not a column here — it lives on the debtor row — so that one
  // sort is applied after the join below. The rest the database can do.
  const column = { amount: 'amount_cents', issued: 'issue_date', due: 'due_date' }[sort];
  let query = supabase
    .from('invoices')
    .select('*')
    .order(column ?? 'due_date', { ascending: column ? !descending : true });
  if (filter === 'pending') query = query.eq('status', 'pending');
  else if (filter === 'paid') query = query.eq('status', 'paid');

  const [{ data: invoices }, { data: debtors }, { data: contacts }, { data: bankMatches }] =
    await Promise.all([
      query.limit(500),
      supabase.from('debtors').select('id, name, vat_number').order('name'),
      supabase.from('dunning_contacts').select('invoice_id, step'),
      // Which invoices a bank credit settled — that link lives on the
      // transaction, and it is what tells a detected transfer apart from a
      // settlement someone typed in by hand.
      supabase
        .from('bank_transactions')
        .select('matched_invoice_id')
        .eq('state', 'settled')
        .not('matched_invoice_id', 'is', null),
    ]);

  const bankSettled = new Set((bankMatches ?? []).map((row) => row.matched_invoice_id));

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d]));

  const stepsByInvoice = new Map<string, Set<DunningStep>>();
  for (const c of contacts ?? []) {
    // A manual reminder has no step: it is a contact, not a rung, and must not
    // move the invoice's position on the ladder.
    if (!c.step) continue;
    const set = stepsByInvoice.get(c.invoice_id) ?? new Set<DunningStep>();
    set.add(c.step);
    stepsByInvoice.set(c.invoice_id, set);
  }

  const today = athensDate();

  // Search and the customer sort run here rather than in SQL: the customer name
  // comes from a separate query, and matching on it in the database would mean a
  // join this page does not otherwise need.
  const needle = q.trim().toLowerCase();
  const nameOf = (id: string) => {
    const debtor = debtorsById.get(id);
    return (debtor ? displayName(debtor) : '') ?? '';
  };

  let visible = invoices ?? [];
  if (needle) {
    visible = visible.filter((invoice) =>
      [invoice.invoice_number, invoice.series, invoice.mark, nameOf(invoice.debtor_id)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }
  if (sort === 'customer') {
    visible = [...visible].sort(
      (a, b) => nameOf(a.debtor_id).localeCompare(nameOf(b.debtor_id)) * (descending ? -1 : 1),
    );
  }

  // Where the bulk action sends the operator back to, filters and all.
  const back = `/invoices?${new URLSearchParams({ filter, sort, dir, ...(q ? { q } : {}) })}`;

  /** A column header that toggles direction when it is already the active sort. */
  const sortHref = (key: string) =>
    `/invoices?${new URLSearchParams({
      filter,
      sort: key,
      dir: sort === key && !descending ? 'desc' : 'asc',
      ...(q ? { q } : {}),
    })}`;

  const bulkSent = Number(params.sent ?? 0);
  const bulkLimited = Number(params.limited ?? 0);
  const bulkSkipped = Number(params.skipped ?? 0);
  const bulkFailed = Number(params.failed ?? 0);
  const bulkLeft = Number(params.left ?? 0);
  const bulkNotDue = Number(params.notDue ?? 0);
  const bulkPaused = Number(params.paused ?? 0);

  // When and how a document was settled. Only worth a column on views that can
  // contain paid rows — the default "open" view would render a column of dashes.
  const showSettled = filter !== 'pending';
  // The actions cell is only ever populated for pending rows, so a paid-only
  // view would render an empty column that just pushes the table wider.
  const showActions = filter !== 'paid';
  // Same labels the payments timeline uses, so the two screens tell one story.
  const methodLabel = {
    card_stripe: t.bank.channels.stripe,
    card_viva: t.bank.channels.viva,
    transfer: t.bank.channels.transfer,
    external: t.invoices.paidMethodExternal,
    billing_system: t.invoices.paidMethodBilling,
  } as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.invoices.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {t.invoices.subtitle}
          </p>
        </div>
        <CreateInvoiceForm debtors={debtors ?? []} />
      </div>

      {contactLimitsDisabled() ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">{t.invoices.limitsOffTitle}</p>
          <p className="mt-1 text-xs leading-relaxed">
            {t.invoices.limitsOffBody}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {FILTER_KEYS.map((key) => (
          <a
            key={key}
            href={`/invoices?filter=${key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filter === key
                ? 'bg-ink-900 text-white'
                : 'border border-ink-300 bg-white text-ink-600 hover:bg-ink-50'
            }`}
          >
            {key === 'pending' ? t.invoices.filterOpen : key === 'paid' ? t.invoices.filterPaid : t.invoices.filterAll}
          </a>
        ))}
      </div>

        <form method="get" className="flex-1 sm:max-w-xs">
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.invoices.search}
            aria-label={t.invoices.search}
            className="w-full rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </form>
      </div>

      {params.bulk === 'none' ? (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
          {t.invoices.bulk.nothingSelected}
        </div>
      ) : null}

      {params.bulk === 'done' ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">{t.invoices.bulk.done(bulkSent)}</p>
          {/* The daily guarantee doing its job is not a failure, and reporting it
              as one would teach the operator to distrust a correct safeguard. */}
          {bulkLimited ? <p className="mt-1 text-xs">{t.invoices.bulk.limited(bulkLimited)}</p> : null}
          {bulkSkipped ? <p className="mt-1 text-xs">{t.invoices.bulk.skipped(bulkSkipped)}</p> : null}
          {bulkNotDue ? <p className="mt-1 text-xs">{t.invoices.bulk.notDue(bulkNotDue)}</p> : null}
          {bulkPaused ? <p className="mt-1 text-xs">{t.invoices.bulk.paused(bulkPaused)}</p> : null}
          {bulkFailed ? <p className="mt-1 text-xs">{t.invoices.bulk.failed(bulkFailed)}</p> : null}
          {bulkLeft ? <p className="mt-1 text-xs">{t.invoices.bulk.capped(bulkLeft)}</p> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader title={t.invoices.count(visible.length)} />

        {!visible.length ? (
          <EmptyState
            title={t.invoices.emptyTitle}
            body={t.invoices.emptyBody}
          />
        ) : (
          <>
          {/* This form wraps only its own controls. It used to wrap the whole
              table, which put each row's "mark paid" form inside it — nested
              forms are invalid HTML, so the browser dropped the inner one, the
              DOM stopped matching what React had rendered, and hydration failed,
              taking every interactive control on the page with it. The checkboxes
              join this form by id instead: that is what the `form` attribute is
              for, and what SelectAll already assumed. */}
          {showActions ? (
            <form
              id="bulk"
              action={sendBulkReminder}
              className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-5 py-3"
            >
              <input type="hidden" name="back" value={back} />
              <select
                name="choice"
                defaultValue="manual"
                className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {REMINDER_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {t.reminder.choices[choice.value] ?? choice.label}
                  </option>
                ))}
              </select>
              {/* Which channels this batch goes out on. Narrows what is possible
                  rather than forcing anything: a customer with no phone still
                  gets nothing when SMS-only is chosen, and is reported as
                  skipped. */}
              <select
                name="only"
                defaultValue="both"
                aria-label={t.reminder.channelLabel}
                className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <option value="both">{t.reminder.channelBoth}</option>
                <option value="email">{t.reminder.channelEmail}</option>
                <option value="sms">{t.reminder.channelSms}</option>
              </select>
                <BulkActions
                  sendLabel={t.invoices.bulk.send}
                  sendingLabel={t.invoices.bulk.sending}
                  scenarioLabel={t.invoices.bulk.runScenario}
                  runScenario={runScenarioForSelected}
                />
            </form>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  {showActions ? (
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
                  {showSettled ? (
                    <th className="px-5 py-2.5 font-medium">{t.invoices.colPaid}</th>
                  ) : null}
                  {showActions ? (
                    <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colActions}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((invoice) => {
                  const status = workflowStatus(
                    invoice,
                    stepsByInvoice.get(invoice.id) ?? new Set(),
                    today,
                    t,
                  );
                  // The creditor's own document number, which is what they and
                  // their customer recognise. The MARK is AADE's id and belongs
                  // underneath it, labelled — not standing in for the number.
                  const number =
                    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || null;
                  const label = number ?? invoice.mark ?? invoice.id.slice(0, 8);

                  const age = aging(invoice, today, t);
                  const debtor = debtorsById.get(invoice.debtor_id);
                  const customer = debtor ? displayName(debtor) : null;

                  return (
                    <tr key={invoice.id} className="border-b border-ink-100 last:border-0">
                      {showActions ? (
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
                              className="h-4 w-4 cursor-pointer rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-5 py-3">
                        {number ? (
                          <div className="font-medium text-ink-900">{number}</div>
                        ) : (
                          <div className="font-medium italic text-ink-400">
                            {t.invoices.noNumber}
                          </div>
                        )}
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
                      <td className="px-5 py-3">
                        {age ? (
                          <Badge tone={age.tone}>{age.label}</Badge>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {/* Shown beside the status rather than only as an
                              action, so a row the sweep is ignoring says so at a
                              glance. A pause nobody can see is one nobody
                              remembers switching on. */}
                          {invoice.automation_enabled === false ? (
                            <Badge tone="neutral">{t.invoices.automationPaused}</Badge>
                          ) : null}
                        </div>
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
                      {showActions ? (
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-3">
                            {invoice.status === 'pending' ? (
                              <>
                                <RemindButton invoiceId={invoice.id} label={label} />
                                <form action={toggleInvoiceAutomation}>
                                  <input type="hidden" name="id" value={invoice.id} />
                                  <input
                                    type="hidden"
                                    name="enabled"
                                    value={String(invoice.automation_enabled !== false)}
                                  />
                                  <button
                                    type="submit"
                                    className={`text-sm ${subtleLinkClass}`}
                                    title={
                                      invoice.automation_enabled === false
                                        ? t.invoices.automationResumeHint
                                        : t.invoices.automationPauseHint
                                    }
                                  >
                                    {invoice.automation_enabled === false
                                      ? t.invoices.automationResume
                                      : t.invoices.automationPause}
                                  </button>
                                </form>
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
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
