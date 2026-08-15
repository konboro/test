import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, subtleLinkClass } from '@/components/ui';
import { aging } from '@/lib/aging';
import { displayName } from '@/lib/debtors';
import { workflowStatus } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
import { contactLimitsDisabled } from '@/lib/limits';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { markInvoicePaid } from './actions';
import { CopyPayLink, CreateInvoiceForm, DueDateButton, RemindButton } from './invoice-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).invoices.title };
}
export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['pending', 'paid', 'all'] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = 'pending' } = await searchParams;
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let query = supabase.from('invoices').select('*').order('due_date', { ascending: true });
  if (filter === 'pending') query = query.eq('status', 'pending');
  else if (filter === 'paid') query = query.eq('status', 'paid');

  const [{ data: invoices }, { data: debtors }, { data: contacts }] = await Promise.all([
    query.limit(500),
    supabase.from('debtors').select('id, name, vat_number').order('name'),
    supabase.from('dunning_contacts').select('invoice_id, step'),
  ]);

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

      <Card>
        <CardHeader title={t.invoices.count(invoices?.length ?? 0)} />

        {!invoices?.length ? (
          <EmptyState
            title={t.invoices.emptyTitle}
            body={t.invoices.emptyBody}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colInvoice}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colCustomer}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colAmount}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colIssue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colDue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colAging}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colStatus}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
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
                        {customer ? (
                          <div className="text-ink-800">{customer}</div>
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
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {invoice.status === 'pending' ? (
                            <>
                              <RemindButton invoiceId={invoice.id} label={label} />
                              <CopyPayLink token={invoice.pay_token} />
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
                          ) : invoice.paid_at ? (
                            <span className="tabular text-xs text-ink-500">
                              {formatDate(invoice.paid_at.slice(0, 10))}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
