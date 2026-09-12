import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardHeader, EmptyState, linkClass } from '@/components/ui';
import { aging } from '@/lib/aging';
import { displayName } from '@/lib/debtors';
import { workflowStatus } from '@/lib/dunning/status';
import { REMINDER_CHOICES } from '@/lib/dunning/templates';
import { getDictionary } from '@/lib/i18n';
import { localeOptions } from '@/lib/i18n/dictionaries';
import { athensDate } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { markBulkPaid, runScenarioForSelected, sendBulkReminder } from './actions';
import { CreateInvoiceForm } from './invoice-forms';
import { BulkActions } from './bulk-actions';
import { InvoiceCards, InvoiceTable, type InvoiceListProps } from './invoice-list';
import { ReportReview } from './report-review';
import { SelectAll } from './select-all';
import { loadScenario } from '@/lib/dunning/engine';
import { effectiveNoticeTexts } from '@/lib/dunning/template-store';
import { requireOrganization } from '@/lib/orgs/active';

export async function generateMetadata() {
  return { title: (await getDictionary()).invoices.title };
}
export const dynamic = 'force-dynamic';

// A bulk press runs as a server action of this page, so the page decides how
// long it may take. Sixty seconds is the ceiling on the current plan; the
// send budget in actions.ts stops the work before this fires, so the
// operator gets a summary rather than a killed request.
export const maxDuration = 60;

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
    /** How many rows a bulk settle actually moved. */
    paid?: string;
    skipped?: string;
    failed?: string;
    notDue?: string;
    paused?: string;
    /** Paid at the provider, discovered when the press asked. */
    settled?: string;
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

  // Needed twice on this page: the create form offers it as a choice, and the
  // status column describes where each invoice sits in it. Loading it once here
  // is what stops the list describing a cadence nobody is on.
  const org = await requireOrganization();
  const scenario = await loadScenario(org.id);
  // For the quick wording editor beside the cadence in the create form.
  const notice = await effectiveNoticeTexts(org.id);

  // Customer is not a column here — it lives on the debtor row — so that one
  // sort is applied after the join below. The rest the database can do.
  const column = { amount: 'amount_cents', issued: 'issue_date', due: 'due_date' }[sort];
  let query = supabase
    .from('invoices')
    .select('*')
    .order(column ?? 'due_date', { ascending: column ? !descending : true });
  if (filter === 'pending') query = query.eq('status', 'pending');
  else if (filter === 'paid') query = query.eq('status', 'paid');

  const [
    { data: invoices },
    { data: debtors },
    { data: contacts },
    { data: bankMatches },
    { data: openReports },
    { data: sentMessages },
    { data: documents },
  ] = await Promise.all([
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
    // What debtors said on the payment page and nobody has reviewed yet.
    // Chasing is already held for these; this screen is where it gets
    // un-held, so the queue sits above the list it is blocking.
    supabase
      .from('invoice_reports')
      .select('id, invoice_id, kind, details, bank_match, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false }),
    // What actually left the building for each invoice. Counted from the send
    // log rather than from dunning_contacts: a contact is a rung claimed on the
    // ladder, while this answers the question an operator asks before pressing
    // Remind again — how many times has this person already been told.
    supabase.from('communications_log').select('invoice_id').eq('status', 'sent'),
    // The scans an invoice was created from. Only the ids: the file itself is
    // fetched through a route that signs a URL on demand, so a list of five
    // hundred rows costs one query rather than five hundred signatures.
    supabase.from('invoice_uploads').select('invoice_id').not('invoice_id', 'is', null),
  ]);

  const bankSettled = new Set((bankMatches ?? []).map((row) => row.matched_invoice_id));
  const reportByInvoice = new Map((openReports ?? []).map((r) => [r.invoice_id, r.kind]));

  const withDocument = new Set((documents ?? []).map((row) => row.invoice_id));

  const sentByInvoice = new Map<string, number>();
  for (const row of sentMessages ?? []) {
    if (!row.invoice_id) continue;
    sentByInvoice.set(row.invoice_id, (sentByInvoice.get(row.invoice_id) ?? 0) + 1);
  }

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

  // The review queue, enriched with the document each report is about. Its
  // invoices are fetched by id rather than taken from `invoices` above: that
  // list obeys the page's filter, and a payment claim must not vanish from the
  // queue because the operator happens to be looking at the paid view.
  const reportInvoiceIds = [...new Set((openReports ?? []).map((r) => r.invoice_id))];
  const { data: reportInvoices } = reportInvoiceIds.length
    ? await supabase
        .from('invoices')
        .select('id, debtor_id, amount_cents, invoice_number, series, mark')
        .in('id', reportInvoiceIds)
    : { data: [] };
  const reportInvoiceById = new Map((reportInvoices ?? []).map((row) => [row.id, row]));

  const reviewable = (openReports ?? []).flatMap((report) => {
    const invoice = reportInvoiceById.get(report.invoice_id);
    if (!invoice) return [];

    return [
      {
        id: report.id,
        kind: report.kind,
        createdAt: report.created_at,
        details: report.details,
        bankMatch: report.bank_match,
        invoiceLabel:
          [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') ||
          invoice.mark ||
          '—',
        invoiceAmountCents: invoice.amount_cents,
        debtorName: nameOf(invoice.debtor_id) || t.debtors.nameMissing,
      },
    ];
  });

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
  const bulkSkipped = Number(params.skipped ?? 0);
  const bulkFailed = Number(params.failed ?? 0);
  const bulkLeft = Number(params.left ?? 0);
  const bulkNotDue = Number(params.notDue ?? 0);
  const bulkPaused = Number(params.paused ?? 0);
  const bulkSettled = Number(params.settled ?? 0);

  // When and how a document was settled. Only worth a column on views that can
  // contain paid rows — the default "open" view would render a column of dashes.
  const showSettled = filter !== 'pending';
  // The actions cell is only ever populated for pending rows, so a paid-only
  // view would render an empty column that just pushes the table wider.
  // The selection column serves the bulk send, which only applies to open
  // invoices. The actions column beside it is no longer tied to this: every
  // row can be deleted, including a settled one.
  const showBulk = filter !== 'paid';

  /**
   * Everything a row needs, derived once.
   *
   * Two layouts read this — a table from `md` up and a stack of cards below it
   * — and the derivations are not trivial: which of the document number, the
   * MARK or a truncated id stands in as the label decides what the customer is
   * shown, and it has to be the same answer on both.
   */
  function view(invoice: (typeof visible)[number]) {
    const status = workflowStatus(
      invoice,
      stepsByInvoice.get(invoice.id) ?? new Set(),
      today,
      t,
    );
    // The creditor's own document number, which is what they and their customer
    // recognise. The MARK is AADE's id and belongs underneath it, labelled —
    // not standing in for the number.
    const number = [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || null;
    const label = number ?? invoice.mark ?? invoice.id.slice(0, 8);
    const debtor = debtorsById.get(invoice.debtor_id);

    return {
      status,
      number,
      label,
      debtor,
      customer: debtor ? displayName(debtor) : null,
      age: aging(invoice, today, t),
    };
  }
  // Same labels the payments timeline uses, so the two screens tell one story.
  const methodLabel = {
    card_stripe: t.bank.channels.stripe,
    card_viva: t.bank.channels.viva,
    card_revolut: t.bank.channels.revolut,
    transfer: t.bank.channels.transfer,
    external: t.invoices.paidMethodExternal,
    billing_system: t.invoices.paidMethodBilling,
  } as const;

  // Handed to both layouts, so a card and a table row cannot disagree about
  // what the same document says.
  const list: InvoiceListProps = {
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
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{t.invoices.title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {t.invoices.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/invoices/upload" className={`text-sm ${linkClass}`}>
            {t.upload.title}
          </Link>
          <CreateInvoiceForm debtors={debtors ?? []} scenario={scenario} notice={notice} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {FILTER_KEYS.map((key) => (
          <a
            key={key}
            href={`/invoices?filter=${key}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition sm:min-h-0 sm:py-1.5 ${
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
            className="min-h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
          />
        </form>
      </div>

      {params.bulk === 'none' ? (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
          {t.invoices.bulk.nothingSelected}
        </div>
      ) : null}

      {params.paid ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">{t.invoices.bulk.paidDone(Number(params.paid))}</p>
        </div>
      ) : null}

      {params.bulk === 'done' ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">{t.invoices.bulk.done(bulkSent)}</p>
          {bulkSkipped ? <p className="mt-1 text-xs">{t.invoices.bulk.skipped(bulkSkipped)}</p> : null}
          {bulkNotDue ? <p className="mt-1 text-xs">{t.invoices.bulk.notDue(bulkNotDue)}</p> : null}
          {bulkPaused ? <p className="mt-1 text-xs">{t.invoices.bulk.paused(bulkPaused)}</p> : null}
          {bulkSettled ? (
            <p className="mt-1 text-xs">{t.invoices.bulk.settled(bulkSettled)}</p>
          ) : null}
          {bulkFailed ? <p className="mt-1 text-xs">{t.invoices.bulk.failed(bulkFailed)}</p> : null}
          {bulkLeft ? <p className="mt-1 text-xs">{t.invoices.bulk.capped(bulkLeft)}</p> : null}
        </div>
      ) : null}

      <ReportReview t={t} reports={reviewable} />

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
          {showBulk ? (
            <form
              id="bulk"
              action={sendBulkReminder}
              className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-5 py-3"
            >
              <input type="hidden" name="back" value={back} />
              <select
                name="choice"
                defaultValue="manual"
                className="min-h-11 rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
              >
                {REMINDER_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {t.reminder.choices[choice.value] ?? choice.value}
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
                className="min-h-11 rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
              >
                <option value="both">{t.reminder.channelBoth}</option>
                <option value="email">{t.reminder.channelEmail}</option>
                <option value="sms">{t.reminder.channelSms}</option>
              </select>

              {/* The language for the batch. Automatic is per customer, which is
                  the only setting that is right for a mixed selection — a batch
                  of 40 Greek customers and 4 foreign ones should not have to be
                  sent twice. Forcing one language is there for the case where
                  the selection is deliberately homogeneous. */}
              <select
                name="lang"
                defaultValue="auto"
                aria-label={t.reminder.languageLabel}
                className="min-h-11 rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
              >
                <option value="auto">{t.fields.localeAuto}</option>
                {localeOptions().map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
                <BulkActions
                  sendLabel={t.invoices.bulk.send}
                  sendingLabel={t.invoices.bulk.sending}
                  scenarioLabel={t.invoices.bulk.runScenario}
                  paidLabel={t.invoices.bulk.markPaid}
                  paidConfirm={t.invoices.bulk.markPaidConfirm}
                  runScenario={runScenarioForSelected}
                  markPaid={markBulkPaid}
                />
            </form>
          ) : null}
          {/* Eleven columns is a table nobody reads on a phone; it reads as a
              horizontal drag with the amount always just off-screen. Below
              `md` each invoice is a card carrying the same facts in the order
              they are actually wanted — who, how much, how late — with the
              controls underneath. From `md` up the table returns, because
              comparing invoices side by side is what it is good at. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-200 px-4 py-2.5 md:hidden">
            {showBulk ? (
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <SelectAll form="bulk" />
                {t.invoices.bulk.selectAll}
              </label>
            ) : null}

            <div className="flex items-center gap-3 text-xs">
              <span className="text-ink-400">{t.invoices.sortBy}</span>
              {(
                [
                  ['customer', t.invoices.colCustomer],
                  ['amount', t.invoices.colAmount],
                  ['issued', t.invoices.colIssue],
                  ['due', t.invoices.colDue],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={sortHref(key)}
                  className={`inline-flex min-h-11 items-center px-1 sm:min-h-0 ${
                    sort === key
                      ? 'font-semibold text-ink-900 underline underline-offset-2'
                      : 'text-ink-500 underline-offset-2 hover:underline'
                  }`}
                >
                  {label}
                  {sort === key ? (descending ? ' ↓' : ' ↑') : ''}
                </Link>
              ))}
            </div>
          </div>

          <InvoiceCards {...list} />

          <InvoiceTable {...list} />
          </>
        )}
      </Card>
    </div>
  );
}
