import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState, linkClass, Stat, subtleLinkClass } from '@/components/ui';
import { aging } from '@/lib/aging';
import { displayName } from '@/lib/debtors';
import { isSnoozed, snoozeDaysLeft } from '@/lib/dunning/snooze';
import { workflowStatus } from '@/lib/dunning/status';
import { MessageLog } from '@/components/message-log';
import { getDictionary } from '@/lib/i18n';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { DeleteButton } from '@/components/delete-button';

import { deleteDebtor } from '../actions';
import { NotificationSwitch } from '../notification-switch';
import { DueDateButton } from '../../invoices/invoice-forms';
import { EditDebtorForm } from '../debtor-forms';
import { SnoozeButton } from '../snooze-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getDictionary();

  const supabase = await createClient();
  const { data } = await supabase.from('debtors').select('name, vat_number').eq('id', id).maybeSingle();

  return { title: data ? (displayName(data) ?? t.debtors.nameMissing) : t.debtors.title };
}

/** One labelled field, matching the list view. */
function Detail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd
        title={value ?? undefined}
        className={`truncate text-sm ${value ? 'text-ink-800' : 'text-ink-400'} ${mono ? 'tabular' : ''}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

/**
 * One customer, with their documents.
 *
 * The contact details and the outstanding documents belong on the same screen:
 * deciding whether to chase someone means knowing both what they owe and whether
 * there is any way to reach them — and for imported customers there usually
 * is not, until someone fills the email in.
 */
export default async function DebtorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getDictionary();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS scopes both of these to the tenant, so a foreign id simply returns
  // nothing rather than another tenant's customer.
  const [
    { data: debtor },
    { data: invoices },
    { data: contacts },
    { data: messages },
    { count: messageCount },
  ] = await Promise.all([
    supabase.from('debtors').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('invoices')
      .select('*')
      .eq('debtor_id', id)
      .order('due_date', { ascending: false }),
    supabase.from('dunning_contacts').select('invoice_id, step').eq('debtor_id', id),
    // Newest first, and capped: this is the recent history of a conversation,
    // not an export. The full record stays on /logs, which the card links to.
    supabase
      .from('communications_log')
      .select('*')
      .eq('debtor_id', id)
      .order('sent_at', { ascending: false })
      .limit(50),
    // Counted rather than measured off the list above, which is capped at 50.
    // The delete dialog quotes this number, and a confirmation that understates
    // what it is about to destroy is worse than no confirmation at all.
    supabase
      .from('communications_log')
      .select('id', { count: 'exact', head: true })
      .eq('debtor_id', id),
  ]);

  if (!debtor) notFound();

  const rows = invoices ?? [];
  const sentMessages = messages ?? [];
  const pending = rows.filter((i) => i.status === 'pending');
  const outstanding = pending.reduce((sum, i) => sum + i.amount_cents, 0);
  const paid = rows
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);

  // Manual reminders carry no step and must not move an invoice along the ladder.
  const stepsByInvoice = new Map<string, Set<DunningStep>>();
  for (const c of contacts ?? []) {
    if (!c.step) continue;
    const set = stepsByInvoice.get(c.invoice_id) ?? new Set<DunningStep>();
    set.add(c.step);
    stepsByInvoice.set(c.invoice_id, set);
  }

  const name = displayName(debtor);
  const reachable = Boolean(debtor.email || debtor.phone);
  const today = athensDate();
  const paused = isSnoozed(debtor, today);

  return (
    <div className="space-y-6">
      <Link href="/debtors" className={`text-sm ${subtleLinkClass}`}>
        {t.debtors.backToList}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {name ? (
              <h1 className="text-xl font-semibold text-ink-900">{name}</h1>
            ) : (
              <h1 className="text-xl font-semibold italic text-ink-400">{t.debtors.nameMissing}</h1>
            )}
            {debtor.muted ? <Badge tone="neutral">{t.debtors.muted}</Badge> : null}
            {paused ? <Badge tone="info">{t.snooze.badge}</Badge> : null}
            {!reachable ? <Badge tone="danger">{t.debtors.noContact}</Badge> : null}
          </div>
          {!name ? (
            <p className="mt-1 text-xs text-amber-700">{t.debtors.nameMissingHint}</p>
          ) : null}
          {/* The whole pause on one line, directly under the name: until when,
              how long that still is, and why it was given. */}
          {paused ? (
            <p className="mt-1.5 text-sm text-brand-700">
              {t.snooze.blockLabel}{' '}
              <span className="tabular font-semibold">
                {formatDate(debtor.snoozed_until as string)}
              </span>
              <span className="text-ink-500">
                {' · '}
                {t.snooze.daysLeft(snoozeDaysLeft(debtor, today) ?? 0)}
              </span>
              {debtor.snooze_note ? (
                <span className="text-ink-600">{` — ${debtor.snooze_note}`}</span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <EditDebtorForm debtor={debtor} />
          <SnoozeButton
            debtorId={debtor.id}
            snoozedUntil={paused ? debtor.snoozed_until : null}
            note={paused ? debtor.snooze_note : null}
          />
          <NotificationSwitch debtorId={debtor.id} muted={debtor.muted} withLabel />
          <DeleteButton
            action={deleteDebtor}
            id={debtor.id}
            trigger={t.common.delete}
            title={t.debtors.deleteTitle}
            body={t.debtors.deleteBody(name ?? t.debtors.nameMissing, rows.length, messageCount ?? 0)}
            warning={(messageCount ?? 0) > 0 ? t.debtors.deleteHistoryWarning : undefined}
            confirmLabel={t.common.delete}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t.debtors.outstandingLabel}
          value={formatMoney(outstanding)}
          hint={t.debtors.openCount(pending.length)}
          tone={outstanding > 0 ? 'warning' : 'default'}
        />
        <Stat label={t.debtors.paidTotal} value={formatMoney(paid)} tone="positive" />
        <Stat label={t.invoices.title} value={String(rows.length)} />
      </div>

      <Card>
        <CardHeader title={t.debtors.contactTitle} />
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
          <Detail label={t.debtors.vat} value={debtor.vat_number} mono />
          <Detail label={t.debtors.emailLabel} value={debtor.email} />
          <Detail label={t.debtors.phoneLabel} value={debtor.phone} mono />
        </dl>
        {debtor.notes ? (
          <div className="border-t border-ink-100 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-ink-400">{t.debtors.notesLabel}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-600">{debtor.notes}</p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title={t.debtors.invoicesTitle}
          subtitle={t.invoices.count(rows.length)}
          action={
            <Link href="/invoices" className={`text-sm ${linkClass}`}>
              {t.invoices.title}
            </Link>
          }
        />

        {rows.length === 0 ? (
          <EmptyState title={t.debtors.noInvoicesTitle} body={t.debtors.noInvoicesBody} />
        ) : (
          <>
            {/* On a phone the six columns collapse to one card per document.
                The amount and how late it is are what someone opens a customer
                to find out; the issue date is the column that always got pushed
                off the edge, and it is the one nobody was looking for. */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {rows.map((invoice) => {
                const status = workflowStatus(
                  invoice,
                  stepsByInvoice.get(invoice.id) ?? new Set(),
                  today,
                  t,
                );
                const number =
                  [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || null;
                const age = aging(invoice, today, t);

                return (
                  <li key={invoice.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* The way through to the document itself. This list was
                            a dead end: it said what was owed and what step the
                            chasing had reached, and gave no way to act on either.
                            Only the number is a link, not the whole row — the due
                            date beside it is a button, and an anchor around a
                            button is both invalid and unusable. */}
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="block truncate font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-900"
                        >
                          {number ?? (
                            <span className="italic text-ink-400">{t.invoices.noNumber}</span>
                          )}
                        </Link>
                        <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                          {invoice.mark ? (
                            <>
                              <span className="text-ink-400">{t.invoices.markLabel}</span>{' '}
                              {invoice.mark}
                            </>
                          ) : (
                            t.invoices.manualSource
                          )}
                        </p>
                        <p className="tabular mt-0.5 text-xs text-ink-500">
                          {t.invoices.colIssue}: {formatDate(invoice.issue_date)}
                        </p>
                        <p className="tabular mt-0.5 text-xs text-ink-500">
                          {t.invoices.colDue}:{' '}
                          <DueDateButton
                            invoiceId={invoice.id}
                            dueDate={invoice.due_date}
                            display={formatDate(invoice.due_date)}
                          />
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-base font-semibold text-ink-900">
                        {formatMoney(invoice.amount_cents, invoice.currency)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {age ? <Badge tone={age.tone}>{age.label}</Badge> : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colInvoice}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.invoices.colAmount}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colIssue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colDue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colAging}</th>
                  <th className="px-5 py-2.5 font-medium">{t.invoices.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const status = workflowStatus(
                    invoice,
                    stepsByInvoice.get(invoice.id) ?? new Set(),
                    today,
                    t,
                  );
                  const number =
                    [invoice.series, invoice.invoice_number].filter(Boolean).join(' ') || null;
                  const age = aging(invoice, today, t);

                  return (
                    <tr key={invoice.id} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-3">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-900"
                        >
                          {number ?? (
                            <span className="italic text-ink-400">{t.invoices.noNumber}</span>
                          )}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      {/*
        Under the invoices, not above them: what is owed is why anyone opens a
        customer, and the correspondence is what they read next — usually to
        answer "have we actually chased this person, and did it arrive?".
      */}
      <Card>
        <CardHeader
          title={t.debtors.messagesTitle}
          subtitle={t.debtors.messagesCount(sentMessages.length)}
          action={
            <Link href="/logs" className={`text-sm ${linkClass}`}>
              {t.debtors.messagesAll}
            </Link>
          }
        />

        {sentMessages.length === 0 ? (
          <EmptyState title={t.debtors.noMessagesTitle} body={t.debtors.noMessagesBody} />
        ) : (
          <MessageLog entries={sentMessages} />
        )}
      </Card>
    </div>
  );
}
