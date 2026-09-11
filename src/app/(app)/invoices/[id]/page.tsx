import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { MessageLog } from '@/components/message-log';
import { Badge, Card, CardHeader, EmptyState, linkClass, subtleLinkClass } from '@/components/ui';
import { displayName } from '@/lib/debtors';
import { loadScenario, stepForInvoice } from '@/lib/dunning/engine';
import { scenarioWithOverrides } from '@/lib/dunning/scenario';
import { stepLabels } from '@/lib/dunning/step-labels';
import { workflowStatus } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
import { athensDate, formatDate, formatMoney } from '@/lib/money';
import { requireOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { markInvoicePaid } from '../actions';
import { CopyPayLink, RemindButton } from '../invoice-forms';

import { InvoiceScenarioForm } from './scenario-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${(await getDictionary()).invoices.title} · ${id.slice(0, 8)}` };
}

/**
 * One invoice, in full.
 *
 * The list answers "what is outstanding". This answers the questions that come
 * after: what has this customer actually been told, what happens next and when,
 * and is any of that different for this document. Those were only knowable by
 * reading three screens and inferring, or by asking someone who could read the
 * database.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const t = await getDictionary();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const org = await requireOrganization();

  // Row-level security scopes this to the company being worked in; the filter is
  // the honest way to get a 404 instead of an empty render for somebody else's id.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!invoice) notFound();

  const [
    { data: debtor },
    { data: contacts },
    { data: messages },
    { data: upload },
    { data: overrides },
    account,
  ] = await Promise.all([
    supabase.from('debtors').select('*').eq('id', invoice.debtor_id).maybeSingle(),
    supabase.from('dunning_contacts').select('step').eq('invoice_id', invoice.id),
    supabase
      .from('communications_log')
      .select('id, debtor_id, channel, step, status, recipient, subject, content, error, sent_at')
      .eq('invoice_id', invoice.id)
      .order('sent_at', { ascending: false }),
    supabase.from('invoice_uploads').select('id').eq('invoice_id', invoice.id).maybeSingle(),
    supabase.from('invoice_dunning_steps').select('*').eq('invoice_id', invoice.id),
    loadScenario(org.id),
  ]);

  // The cadence THIS document follows — the account's, with the invoice's own
  // rows on top when it has some. The page used to show the account values
  // everywhere: the editor opened prefilled with a cadence that was not the
  // invoice's, and one untouched save later the override was silently gone.
  // "Next step" answered off the wrong ladder for the same reason.
  const scenario =
    invoice.scenario_mode === 'custom' && overrides?.length
      ? scenarioWithOverrides(
          account,
          overrides.map((row) => ({
            step: row.step,
            enabled: row.enabled,
            offset_days: row.offset_days,
            channels: row.channels,
          })),
        )
      : account;

  // The rungs the editor renders: everything the account places, plus anything
  // this invoice enabled on its own. Derived from enablement alone, a rung the
  // invoice switched OFF would vanish from the screen — and an untouched save
  // would then read as "same as the account" and erase that override.
  const accountPlaced = new Set(
    account.steps.filter((step) => step.enabled).map((step) => step.step),
  );
  const shownSteps = scenario.steps
    .filter((step) => step.enabled || accountPlaced.has(step.step))
    .map((step) => step.step);

  const today = athensDate();
  const stepName = stepLabels(t);

  const completed = new Set(
    (contacts ?? []).map((row) => row.step).filter((step): step is DunningStep => Boolean(step)),
  );

  const status = workflowStatus(invoice, completed, today, t, scenario);

  // What the sweep would do next, said plainly. `off` is answered by the mode
  // rather than by the ladder, which would otherwise name a step that is never
  // going to fire.
  const next =
    invoice.scenario_mode === 'off' || invoice.status !== 'pending'
      ? null
      : stepForInvoice(invoice.due_date, today, scenario);

  const number = [invoice.series, invoice.invoice_number].filter(Boolean).join(' ');

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className={`text-sm ${linkClass}`}>
          ← {t.invoices.title}
        </Link>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold text-ink-900">
            {number || t.invoices.noNumber}
          </h1>
          <span className="tabular text-xl font-semibold text-ink-900">
            {formatMoney(invoice.amount_cents, invoice.currency)}
          </span>
        </div>

        <p className="mt-1 text-sm text-ink-500">
          {debtor ? (
            <Link href={`/debtors/${debtor.id}`} className={linkClass}>
              {displayName(debtor) ?? t.debtors.nameMissing}
            </Link>
          ) : (
            t.debtors.nameMissing
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {upload ? (
            <a
              href={`/api/invoices/${invoice.id}/document`}
              target="_blank"
              rel="noreferrer"
              className={`text-sm ${linkClass}`}
            >
              {t.invoices.openDocument}
            </a>
          ) : null}
        </div>

        {/* The things a person came here to do.
            This page could describe an invoice in full — what it is owed, where
            the chasing had reached, every message already sent — and offered no
            way to act on any of it. Everything had to be done from the list
            instead, by finding the same row again. The controls are the ones the
            list already carries, so a habit learned in one place works in the
            other; chasing is gated on the invoice still being open, because
            there is nothing to chase once it is settled. */}
        {invoice.status === 'pending' ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <RemindButton invoiceId={invoice.id} label={number || invoice.id.slice(0, 8)} />
            <CopyPayLink code={invoice.short_code ?? invoice.pay_token} />
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
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader title={t.invoiceScenario.title} />

        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5">
          <div>
            <dt className="text-xs text-ink-500">{t.invoices.colDue}</dt>
            <dd className="tabular mt-0.5 text-ink-900">{formatDate(invoice.due_date)}</dd>
          </div>

          <div>
            <dt className="text-xs text-ink-500">{t.invoiceScenario.nextStep}</dt>
            <dd className="mt-0.5 text-ink-900">
              {next ? stepName[next.step] : t.invoiceScenario.nextNone}
            </dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="text-xs text-ink-500">{t.scenario.onIssueTitle}</dt>
            <dd className="mt-0.5 text-ink-900">
              {invoice.issue_notice_sent_at
                ? `${t.invoiceScenario.issueNoticeSent} — ${formatDate(invoice.issue_notice_sent_at.slice(0, 10))}`
                : t.invoiceScenario.issueNoticePending}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title={t.scenario.title} subtitle={t.scenario.hint} />
        <InvoiceScenarioForm
          invoiceId={invoice.id}
          scenario={scenario}
          mode={invoice.scenario_mode}
          show={shownSteps}
        />
      </Card>

      <Card>
        <CardHeader
          title={t.debtors.messagesTitle}
          subtitle={t.debtors.messagesCount((messages ?? []).length)}
        />
        {(messages ?? []).length === 0 ? (
          <EmptyState title={t.debtors.noMessagesTitle} body={t.debtors.noMessagesBody} />
        ) : (
          <MessageLog entries={messages ?? []} />
        )}
      </Card>
    </div>
  );
}
