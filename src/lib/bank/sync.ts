/**
 * Reading the creditor's bank feed and settling what it explains.
 *
 * Runs at the head of the daily sweep, before any reminder is considered. That
 * order is the point of the feature: an invoice paid by transfer yesterday
 * leaves the candidate set this morning instead of being chased for another
 * week, and auto-stop then does the rest without knowing bank feeds exist.
 */

import { athensDate } from '@/lib/money';
import { notifyPaymentReceived } from '@/lib/payments/notify';
import { createAdminClient } from '@/lib/supabase/admin';

import {
  BankApiError,
  bankingConfigured,
  fetchCredits,
  type IncomingCredit,
  type PsuContext,
  type ReadDiagnostic,
} from './client';
import { matchCredit, type InvoiceCandidate } from './match';

export interface BankSyncResult {
  connectionsChecked: number;
  /** Rows the bank returned, before debits and unparseable entries are dropped. */
  fetched: number;
  creditsSeen: number;
  creditsNew: number;
  settled: number;
  queued: number;
  /** Connections left alone because an unattended read was not due yet. */
  throttled: number;
  expired: string[];
  errors: Array<{ connectionId: string; error: string }>;
}

/**
 * How far back to ask on every run.
 *
 * Banks book late and occasionally restate: a window that started where the
 * last one ended would lose anything that landed with an earlier date after we
 * had already moved past it. Re-reading a week costs nothing, because ingest is
 * idempotent on the provider's own transaction id.
 */
const OVERLAP_DAYS = 7;
const FIRST_RUN_DAYS = 90;

/** Enough for a very busy 90-day window; a backstop, not a real limit. */
const MAX_PAGES = 20;

/**
 * How long an unattended read must leave between calls.
 *
 * PSD2 caps how often a provider may read an account with nobody present.
 * Enable Banking allows four a day and answers the fifth with "The access on
 * the account has been exceeding the consented multiplicity per day".
 *
 * The sweep was reading on every invocation — the daily Vercel cron plus the
 * hourly GitHub workflow, which lands roughly six times a day — so most of the
 * day's reads were refused, the feed stopped seeing incoming transfers, and the
 * only trace was an error inside a JSON body nobody reads. Measured on the
 * production logs before this was written: three of the last five runs refused.
 *
 * Six hours is four reads a day: the whole allowance and no more. An attended
 * read is exempt under the same rules, because the customer is there to
 * authorise it, so the operator pressing Sync is never throttled here.
 */
const UNATTENDED_MIN_HOURS = 6;

/** Whether an unattended read of this connection is due. */
function unattendedReadDue(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;

  const last = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(last)) return true;

  return Date.now() - last >= UNATTENDED_MIN_HOURS * 60 * 60 * 1000;
}

export async function syncBankFeeds(
  options: { userId?: string; psu?: PsuContext | null } = {},
): Promise<BankSyncResult> {
  const result: BankSyncResult = {
    connectionsChecked: 0,
    fetched: 0,
    creditsSeen: 0,
    creditsNew: 0,
    settled: 0,
    queued: 0,
    throttled: 0,
    expired: [],
    errors: [],
  };

  if (!bankingConfigured()) return result;

  const supabase = createAdminClient();

  let query = supabase
    .from('bank_connections')
    .select('*')
    .eq('status', 'active')
    .not('account_id', 'is', null);

  if (options.userId) query = query.eq('user_id', options.userId);

  const { data: connections, error } = await query;
  if (error) {
    result.errors.push({ connectionId: '-', error: `loading connections: ${error.message}` });
    return result;
  }

  for (const connection of connections ?? []) {
    result.connectionsChecked += 1;

    // Consent lapses silently — the feed simply stops returning data. Retiring
    // the connection here is what lets the panel say so out loud.
    if (connection.consent_expires_at && new Date(connection.consent_expires_at) <= new Date()) {
      await supabase.from('bank_connections').update({ status: 'expired' }).eq('id', connection.id);
      result.expired.push(connection.id);
      continue;
    }

    // Nobody is present, so the bank counts this against a daily allowance.
    // Asking again before it is due does not fetch anything — it spends a
    // read on a 429 and leaves the rest of the day with none.
    if (!options.psu && !unattendedReadDue(connection.last_synced_at)) {
      result.throttled += 1;
      continue;
    }

    try {
      await syncConnection(connection, result, options.psu);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      result.errors.push({ connectionId: connection.id, error: message });

      // A 401 after a successful link means the consent is gone, whatever the
      // stored expiry claims.
      if (cause instanceof BankApiError && (cause.status === 401 || cause.status === 403)) {
        await supabase.from('bank_connections').update({ status: 'expired' }).eq('id', connection.id);
        result.expired.push(connection.id);
      }
    }
  }

  return result;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  account_id: string | null;
  consent_expires_at: string | null;
  last_synced_at: string | null;
}

async function syncConnection(
  connection: ConnectionRow,
  result: BankSyncResult,
  psu?: PsuContext | null,
): Promise<void> {
  if (!connection.account_id) return;

  const supabase = createAdminClient();
  const since = windowStart(connection.last_synced_at);

  // Follow the pages. The first response carries a continuation key whenever the
  // bank has more, and reading only page one silently loses the oldest part of
  // the window — on a busy account that is most of it, with nothing to show that
  // anything was missed. Bounded so a provider that always returns a key cannot
  // spin here forever.
  let continuationKey: string | null = null;
  let page = 0;

  // Per-connection, because `result` accumulates across every account the tenant
  // has linked and these are stored on one row.
  let fetchedHere = 0;
  let creditsHere = 0;
  // First page only: it is a shape check, and every page of one response has the
  // same shape. Keeping the last would just describe whichever page happened to
  // be last.
  let diagnostic: ReadDiagnostic | null = null;

  do {
    const batch = await fetchCredits(connection.account_id, since, continuationKey, psu);

    result.fetched += batch.fetched;
    result.creditsSeen += batch.credits.length;
    if (!diagnostic) diagnostic = batch.diagnostic;
    fetchedHere += batch.fetched;
    creditsHere += batch.credits.length;

    for (const credit of batch.credits) {
      const outcome = await ingest(connection, credit);

      if (outcome.kind === 'failed') {
        // Loud, and counted. A credit we could not store is exactly the thing
        // the operator needs to hear about: the bank has money we cannot see.
        result.errors.push({
          connectionId: connection.id,
          error: `Storing a credit: ${outcome.error}`,
        });
        continue;
      }

      if (outcome.kind === 'duplicate') continue;

      result.creditsNew += 1;
      await reconcile(connection.user_id, outcome.id, credit, result);
    }

    continuationKey = batch.continuationKey;
    page += 1;
  } while (continuationKey && page < MAX_PAGES);

  // Kept so an empty result stays explainable after the fact. Rows fetched but
  // no credits means either nothing incoming, or a response whose shape the
  // parser does not recognise — and those look identical everywhere else.
  await supabase
    .from('bank_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      last_fetched_count: fetchedHere,
      last_credit_count: creditsHere,
      last_read_diagnostic: diagnostic,
    })
    .eq('id', connection.id);

  console.info('[bank:read]', {
    connectionId: connection.id,
    since,
    pages: page,
    fetched: fetchedHere,
    credits: creditsHere,
    shape: diagnostic,
    attended: Boolean(psu),
  });
}

function windowStart(lastSyncedAt: string | null): string {
  const days = lastSyncedAt ? OVERLAP_DAYS : FIRST_RUN_DAYS;
  const from = new Date(lastSyncedAt ?? Date.now());
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString().slice(0, 10);
}

/**
 * What storing one credit did.
 *
 * Three outcomes, not two. The old code returned an id or null and treated
 * every failure as "seen this already", so a credit that failed to store for
 * any other reason — a dropped connection, a column constraint, a permissions
 * change — was skipped in silence. That is money that arrived in the bank and
 * never reached the review queue, and the run reported a clean result.
 */
export type IngestOutcome =
  | { kind: 'new'; id: string }
  | { kind: 'duplicate' }
  | { kind: 'failed'; error: string };

/** Postgres unique-violation: the statement was fetched again, as designed. */
const UNIQUE_VIOLATION = '23505';

/**
 * Reads the insert's answer.
 *
 * Separate from the call so the one judgement that matters — "already have it"
 * against "could not store it" — can be pinned down without a database.
 */
export function ingestOutcome(
  error: { code?: string | null; message: string } | null,
  id: string | null | undefined,
): IngestOutcome {
  if (error) {
    // The unique index on (connection_id, provider_tx_id) doing its job.
    if (error.code === UNIQUE_VIOLATION) return { kind: 'duplicate' };
    return { kind: 'failed', error: error.message };
  }

  if (!id) return { kind: 'failed', error: 'the insert returned no row' };

  return { kind: 'new', id };
}

/**
 * Store the credit, or recognise it as one we already have.
 *
 * Reports a genuine failure as a failure, so an unexplained credit is never
 * dropped quietly — the whole point of the feed is that money arriving gets
 * seen by somebody.
 */
async function ingest(connection: ConnectionRow, credit: IncomingCredit): Promise<IngestOutcome> {
  const { data, error } = await createAdminClient()
    .from('bank_transactions')
    .insert({
      user_id: connection.user_id,
      connection_id: connection.id,
      provider_tx_id: credit.providerTxId,
      booked_on: credit.bookedOn,
      amount_cents: credit.amountCents,
      currency: credit.currency,
      remittance: credit.remittance,
      counterparty_name: credit.counterpartyName,
      counterparty_iban: credit.counterpartyIban,
      bank_transaction_code: credit.bankTransactionCode,
    })
    .select('id')
    .maybeSingle();

  return ingestOutcome(error, data?.id);
}

async function reconcile(
  userId: string,
  transactionId: string,
  credit: IncomingCredit,
  result: BankSyncResult,
): Promise<void> {
  const supabase = createAdminClient();
  const candidates = await candidatesFor(userId, credit);
  const decision = matchCredit(credit, candidates);

  if (decision.kind === 'unmatched') return;

  if (decision.kind === 'review') {
    await supabase.from('bank_transactions').update({ state: 'review' }).eq('id', transactionId);
    result.queued += 1;
    return;
  }

  // Same guard the Stripe paths use: conditional on the invoice still being
  // pending, so a card payment that landed in the same window wins and this
  // simply does nothing.
  const { data: settled } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_amount_cents: credit.amountCents,
    })
    .eq('id', decision.invoiceId)
    .eq('status', 'pending')
    .select('id');

  if (!settled?.length) {
    // Something else settled it first. The transaction still belongs to that
    // invoice, but it did not cause the transition and must not notify.
    await supabase
      .from('bank_transactions')
      .update({ state: 'review', matched_invoice_id: decision.invoiceId })
      .eq('id', transactionId);
    result.queued += 1;
    return;
  }

  await supabase
    .from('bank_transactions')
    .update({
      state: 'settled',
      matched_invoice_id: decision.invoiceId,
      match_signals: decision.signals,
      matched_at: new Date().toISOString(),
    })
    .eq('id', transactionId);

  result.settled += 1;
  await notifyPaymentReceived(decision.invoiceId);
}

/**
 * Open invoices this credit could belong to, with the evidence each carries.
 *
 * Known IBANs come from transfers that already settled an invoice for the same
 * debtor: the first payment teaches us the account, every later one can lean on
 * it. Pairs an operator has rejected are excluded, so an undone match is never
 * proposed twice.
 */
async function candidatesFor(userId: string, credit: IncomingCredit): Promise<InvoiceCandidate[]> {
  const supabase = createAdminClient();

  const [{ data: invoices }, { data: debtors }, { data: history }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, debtor_id, amount_cents, currency, issue_date, invoice_number, series, mark')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('amount_cents', credit.amountCents)
      .eq('currency', credit.currency)
      .lte('issue_date', credit.bookedOn),
    supabase.from('debtors').select('id, name').eq('user_id', userId),
    supabase
      .from('bank_transactions')
      .select('counterparty_iban, matched_invoice_id')
      .eq('user_id', userId)
      .eq('state', 'settled')
      .not('counterparty_iban', 'is', null),
  ]);

  if (!invoices?.length) return [];

  const debtorNames = new Map((debtors ?? []).map((d) => [d.id, d.name]));

  // invoice -> debtor, so a settled transfer teaches the debtor's account.
  const settledInvoiceIds = (history ?? [])
    .map((h) => h.matched_invoice_id)
    .filter((id): id is string => id !== null);
  const { data: settledInvoices } = settledInvoiceIds.length
    ? await supabase.from('invoices').select('id, debtor_id').in('id', settledInvoiceIds)
    : { data: [] };

  const debtorOfInvoice = new Map((settledInvoices ?? []).map((i) => [i.id, i.debtor_id]));
  const ibansByDebtor = new Map<string, string[]>();

  for (const row of history ?? []) {
    const debtorId = row.matched_invoice_id ? debtorOfInvoice.get(row.matched_invoice_id) : null;
    if (!debtorId || !row.counterparty_iban) continue;
    ibansByDebtor.set(debtorId, [...(ibansByDebtor.get(debtorId) ?? []), row.counterparty_iban]);
  }

  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    amountCents: invoice.amount_cents,
    currency: invoice.currency,
    issueDate: invoice.issue_date,
    invoiceNumber: invoice.invoice_number,
    series: invoice.series,
    mark: invoice.mark,
    debtorName: debtorNames.get(invoice.debtor_id) ?? null,
    debtorIbans: ibansByDebtor.get(invoice.debtor_id) ?? [],
  }));
}

/** Exposed for the panel: today's date in the tenant's timezone. */
export const syncStamp = athensDate;
