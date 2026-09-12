/**
 * Enable Banking — account information only.
 *
 * The provider holds the AISP licence and lefta operates under it, which is the
 * whole reason for using an aggregator: reading a creditor's bank feed is a
 * regulated activity and we are not the regulated party.
 *
 * Authentication is not an API key. Every request carries a JWT signed with the
 * application's RSA private key, so the secret never travels — only signatures
 * derived from it do.
 */

import { createHash, createSign } from 'node:crypto';

import { optionalEnv, requireEnv } from '@/lib/env';

const API = 'https://api.enablebanking.com';

/** Whether a bank feed can be read at all. Mirrors `providers.ts` in intent. */
export function bankingConfigured(): boolean {
  return Boolean(optionalEnv('ENABLE_BANKING_APP_ID') && optionalEnv('ENABLE_BANKING_PRIVATE_KEY'));
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * A one-hour bearer for a single burst of calls.
 *
 * Minted per request rather than cached: signing is cheap, and a cached token
 * outliving its hour is a class of bug that only shows up in production.
 */
export function signedJwt(now = Date.now()): string {
  const kid = requireEnv('ENABLE_BANKING_APP_ID');
  const key = requireEnv('ENABLE_BANKING_PRIVATE_KEY');

  const issuedAt = Math.floor(now / 1000);
  const input = `${base64url({ typ: 'JWT', alg: 'RS256', kid })}.${base64url({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;

  const signature = createSign('RSA-SHA256').update(input).sign(key).toString('base64url');
  return `${input}.${signature}`;
}

/**
 * Evidence that a human is waiting on the other end of this request.
 *
 * PSD2 splits account access in two. Unattended polling is capped — the banks
 * choose the number and several settle on four a day — while a request made
 * because the account holder is sitting there asking for it is exempt. The only
 * thing that tells the bank which kind it is receiving is `PSU-IP-Address`: set,
 * and the customer is present; absent, and it counts against the daily quota.
 *
 * So this is never inferred or faked. The nightly sweep runs with no PSU context
 * at all, because nobody is there — asserting otherwise would be a false
 * statement to the bank about why we are reading someone's account, which is the
 * one thing this regulation is actually about.
 */
export interface PsuContext {
  ipAddress: string;
  userAgent?: string | null;
}

function psuHeaders(psu?: PsuContext | null): Record<string, string> {
  if (!psu?.ipAddress) return {};

  return {
    'PSU-IP-Address': psu.ipAddress,
    ...(psu.userAgent ? { 'PSU-User-Agent': psu.userAgent } : {}),
  };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${signedJwt()}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as
      | (T & { message?: string; error?: string })
      | null;

    if (!response.ok) {
      // 429 carries the reset window: banks cap this at about four calls per
      // account per day, and retrying into a closed window just burns another.
      const detail = body?.message ?? body?.error ?? '';
      throw new BankApiError(
        `Enable Banking ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        response.headers.get('x-ratelimit-account-success-reset'),
      );
    }

    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export class BankApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: string | null = null,
  ) {
    super(message);
    this.name = 'BankApiError';
  }
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  psu_types?: string[];
  /** Seconds. Greek banks currently allow 180 days; Trade Republic allows 90. */
  maximum_consent_validity?: number;
}

export async function listAspsps(country: string): Promise<Aspsp[]> {
  const body = await call<{ aspsps?: Aspsp[] }>(`/aspsps?country=${encodeURIComponent(country)}`);
  return body.aspsps ?? [];
}

export interface AuthStart {
  url: string;
  authorization_id: string;
}

/**
 * Begins the bank handshake. Nothing is authorised until the creditor completes
 * SCA at their bank and comes back to `redirectUrl`.
 */
export async function startAuth(params: {
  aspspName: string;
  country: string;
  redirectUrl: string;
  state: string;
  validUntil: Date;
  psuType?: 'business' | 'personal';
}): Promise<AuthStart> {
  return call<AuthStart>('/auth', {
    method: 'POST',
    body: JSON.stringify({
      access: { valid_until: params.validUntil.toISOString().replace(/\.\d{3}Z$/, 'Z') },
      aspsp: { name: params.aspspName, country: params.country },
      state: params.state,
      redirect_url: params.redirectUrl,
      psu_type: params.psuType ?? 'business',
    }),
  });
}

export interface SessionAccount {
  uid: string;
  identification_hash?: string;
  account_id?: { iban?: string };
}

export interface BankSession {
  session_id: string;
  accounts: SessionAccount[];
  access?: { valid_until?: string };
}

export async function createSession(code: string): Promise<BankSession> {
  return call<BankSession>('/sessions', { method: 'POST', body: JSON.stringify({ code }) });
}

/**
 * Raw transaction as the provider returns it.
 *
 * Field names follow the Berlin Group shape the API is modelled on. This
 * interface and `toCredit` below are the only places that know it — everything
 * downstream works on our own type, so confirming it against the first real
 * response is a one-function change.
 */
interface RawTransaction {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount?: { amount?: string; currency?: string };
  credit_debit_indicator?: string;
  status?: string;
  booking_date?: string;
  value_date?: string;
  remittance_information?: string[] | string;
  debtor?: { name?: string };
  debtor_account?: { iban?: string; identification?: string };
  creditor_account?: { iban?: string; identification?: string };
  reference_number?: string;
  bank_transaction_code?:
    | string
    | { code?: string; description?: string; domain?: string; family?: string; sub_family?: string };
  creditor?: { name?: string };
}

/**
 * Why a batch produced nothing, in names and counts only.
 *
 * Deliberately carries no values. The statement names people who never signed up
 * to this platform, and explaining an empty result is not a reason to copy their
 * payments somewhere else. Key names are schema rather than data, and they are
 * the one thing that settles whether the response is shaped the way the mapper
 * believes — Enable Banking's own documentation says snake_case in one place and
 * camelCase in another.
 */
export interface ReadDiagnostic {
  total: number;
  missingId: number;
  missingAmount: number;
  missingCurrency: number;
  missingDate: number;
  nonPositive: number;
  /** e.g. { CRDT: 2, DBIT: 17 } — codes, not data. */
  indicators: Record<string, number>;
  /** Top-level keys seen on the first row. */
  keys: string[];
  /**
   * How many rows carry each field that could name the payer.
   *
   * Eurobank leaves `debtor` empty on every row, exactly as it does the id, so
   * the panel shows no payer. Whether that identity lives under another key or
   * is simply not disclosed is a question about the response, and counting is
   * the only honest way to answer it. Counts, never values.
   */
  populated: Record<string, number>;
  /** The bank's own movement codes and how often each appeared. */
  codes: Record<string, number>;
}

export function diagnose(raw: RawTransaction[]): ReadDiagnostic {
  const d: ReadDiagnostic = {
    total: raw.length,
    missingId: 0,
    missingAmount: 0,
    missingCurrency: 0,
    missingDate: 0,
    nonPositive: 0,
    indicators: {},
    keys: raw.length ? Object.keys(raw[0] as object).sort() : [],
    populated: {},
    codes: {},
  };

  const bump = (field: string, present: unknown) => {
    if (present) d.populated[field] = (d.populated[field] ?? 0) + 1;
  };

  for (const row of raw) {
    if (!(row.entry_reference ?? row.transaction_id)) d.missingId += 1;
    if (!row.transaction_amount?.amount) d.missingAmount += 1;
    if (!row.transaction_amount?.currency) d.missingCurrency += 1;
    if (!(row.booking_date ?? row.value_date)) d.missingDate += 1;

    const amount = row.transaction_amount?.amount;
    if (amount && toMinorUnits(amount) <= 0) d.nonPositive += 1;

    bump('debtor.name', row.debtor?.name);
    bump('creditor.name', row.creditor?.name);
    bump('debtor_account', accountIdentification(row.debtor_account));
    bump('creditor_account', accountIdentification(row.creditor_account));
    bump('reference_number', row.reference_number);
    bump('remittance', Array.isArray(row.remittance_information) ? row.remittance_information.length : row.remittance_information);

    const code = transactionCode(row);
    if (code) d.codes[code] = (d.codes[code] ?? 0) + 1;

    const indicator = row.credit_debit_indicator ?? '(absent)';
    d.indicators[indicator] = (d.indicators[indicator] ?? 0) + 1;
  }

  return d;
}

export interface IncomingCredit {
  providerTxId: string;
  /** The bank's own classification, verbatim. Null when it sends none. */
  bankTransactionCode: string | null;
  amountCents: number;
  currency: string;
  bookedOn: string;
  remittance: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
}

/** Minor units from a decimal string, without going through a float. */
export function toMinorUnits(amount: string): number {
  const [whole = '0', fraction = ''] = amount.replace('+', '').split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const digits = `${whole.replace('-', '')}${fraction.padEnd(2, '0').slice(0, 2)}`;
  return sign * Number(digits);
}

/**
 * One raw transaction as a credit we can match, or null if it is not one.
 *
 * Debits are dropped here rather than filtered later: a creditor's outgoing
 * payments are none of this product's business and should never reach storage.
 */
/**
 * A stable id for a transaction the bank did not identify.
 *
 * Eurobank returns `entry_reference` and `transaction_id` empty on every row, and
 * ingest keys on that id — so without a substitute the whole statement is
 * discarded, which is exactly what was happening.
 *
 * Derived from the fields that describe the movement itself, so the same
 * transaction hashes the same way on every run and the seven-day overlap
 * re-reads it without creating a duplicate. `reference_number` is deliberately
 * not used as an identity: it is the payer's reference, and two payments can
 * legitimately carry the same one.
 *
 * Genuinely identical movements on the same day — same amount, same payer, same
 * reference — are distinguished by their position in the response. That relies
 * on booked transactions coming back in a stable order, which they do; the
 * alternative is collapsing two real payments into one, and losing money is the
 * worse failure of the two.
 */
export function transactionSignature(raw: RawTransaction): string {
  const signature = [
    raw.booking_date ?? '',
    raw.value_date ?? '',
    raw.transaction_amount?.amount ?? '',
    raw.transaction_amount?.currency ?? '',
    raw.credit_debit_indicator ?? '',
    raw.debtor?.name ?? '',
    accountIdentification(raw.debtor_account) ?? '',
    accountIdentification(raw.creditor_account) ?? '',
    Array.isArray(raw.remittance_information)
      ? raw.remittance_information.join(' ')
      : (raw.remittance_information ?? ''),
  ].join('|');

  return `derived:${createHash('sha256').update(signature).digest('hex').slice(0, 32)}`;
}

/**
 * The bank's own classification, flattened to one string.
 *
 * ISO 20022 splits it into domain / family / sub-family; banks also send a
 * single proprietary code, and some send a human description instead. Kept
 * verbatim rather than mapped into our own vocabulary — inventing a taxonomy
 * before seeing real values is exactly how the parser came to discard every
 * row for a month.
 */
export function transactionCode(raw: RawTransaction): string | null {
  const code = raw.bank_transaction_code;
  if (!code) return null;
  if (typeof code === 'string') return code.trim() || null;

  const parts = [code.domain, code.family, code.sub_family].filter(Boolean);
  if (parts.length) return parts.join('/');

  return code.code?.trim() || code.description?.trim() || null;
}

/** Banks disagree on the key; both spellings mean the account number. */
function accountIdentification(
  account: { iban?: string; identification?: string } | undefined,
): string | null {
  return account?.iban?.trim() || account?.identification?.trim() || null;
}

export function toCredit(raw: RawTransaction, fallbackId?: string): IncomingCredit | null {
  const providerTxId = raw.entry_reference?.trim() || raw.transaction_id?.trim() || fallbackId;
  const amount = raw.transaction_amount?.amount;
  const currency = raw.transaction_amount?.currency;
  const bookedOn = raw.booking_date ?? raw.value_date;

  if (!providerTxId || !amount || !currency || !bookedOn) return null;

  // Only an explicit credit counts.
  //
  // This used to accept a movement whose direction the bank had not stated, on
  // the grounds that the amount was positive. Under PSD2 the amount usually is
  // positive on both sides and the indicator carries the sign, so a bank that
  // omits the field would have had its outgoing payments read as customer
  // receipts — and a receipt is what settles an invoice. Every transaction on
  // the statement this was written against carried the field, so requiring it
  // costs nothing there and fails towards not marking a debt paid, which is the
  // direction a mistake about money should fail in.
  if (raw.credit_debit_indicator !== 'CRDT') {
    if (!raw.credit_debit_indicator) {
      console.warn('[bank] movement with no credit/debit indicator, skipped', providerTxId);
    }
    return null;
  }

  const amountCents = toMinorUnits(amount);
  if (amountCents <= 0) return null;

  const remittance = Array.isArray(raw.remittance_information)
    ? raw.remittance_information.join(' ').trim()
    : (raw.remittance_information ?? '').trim();

  return {
    providerTxId,
    amountCents,
    currency,
    bookedOn: bookedOn.slice(0, 10),
    remittance: remittance || null,
    bankTransactionCode: transactionCode(raw),
    // Which side is the counterparty depends on the direction, and the bank
    // labels from the transaction's perspective rather than the account
    // holder's: on an incoming payment `creditor_account` is *our* account and
    // the payer would be under `debtor`. Measured on a real statement — the 17
    // debits carried debtor_account, the 2 credits carried creditor_account,
    // both of them this account. Taking the populated one on sight would file
    // the creditor's own IBAN as their customer's.
    //
    // Only credits are stored, so this resolves to the debtor today. It is
    // written out anyway because the alternative is a line that happens to be
    // right for reasons nothing states.
    ...counterparty(raw),
  };
}

function counterparty(raw: RawTransaction): {
  counterpartyName: string | null;
  counterpartyIban: string | null;
} {
  const outgoing = raw.credit_debit_indicator === 'DBIT';

  return {
    counterpartyName: (outgoing ? raw.creditor?.name : raw.debtor?.name)?.trim() || null,
    counterpartyIban: accountIdentification(outgoing ? raw.creditor_account : raw.debtor_account),
  };
}

/**
 * Maps a whole response, in the order the bank sent it.
 *
 * Order matters because the substitute id counts repeats: two identical rows in
 * the same statement are the second and third occurrence of that signature, and
 * only their position separates them. Mapping row by row in isolation could not
 * see that.
 */
export function mapCredits(raw: RawTransaction[]): IncomingCredit[] {
  const seen = new Map<string, number>();
  const credits: IncomingCredit[] = [];

  for (const row of raw) {
    // Counted before the credit/debit test, so a debit still consumes its slot.
    // Otherwise removing an outgoing payment from the middle of the statement
    // would renumber everything after it and re-ingest the lot as new.
    const base = transactionSignature(row);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    const credit = toCredit(row, `${base}:${occurrence}`);
    if (credit) credits.push(credit);
  }

  return credits;
}

/**
 * Booked transactions from a date onwards.
 *
 * Pending entries are deliberately excluded: they can still be recalled, and
 * settling an invoice on money that has not arrived is the failure this whole
 * feature exists to avoid.
 */
export async function fetchCredits(
  accountUid: string,
  since: string,
  continuationKey?: string | null,
  psu?: PsuContext | null,
): Promise<{
  credits: IncomingCredit[];
  fetched: number;
  continuationKey: string | null;
  diagnostic: ReadDiagnostic;
}> {
  const query = new URLSearchParams({ date_from: since, transaction_status: 'BOOK' });
  if (continuationKey) query.set('continuation_key', continuationKey);

  const body = await call<{ transactions?: RawTransaction[]; continuation_key?: string }>(
    `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`,
    { headers: psuHeaders(psu) },
  );

  const raw = body.transactions ?? [];

  return {
    diagnostic: diagnose(raw),
    credits: mapCredits(raw),
    // How many the bank returned, before anything was dropped. `toCredit`
    // returns null whenever a field it needs is missing, so a schema that does
    // not match would discard every row and look exactly like an empty account.
    // This one number tells those two apart, which is otherwise unanswerable
    // without the provider credentials in hand.
    fetched: raw.length,
    continuationKey: body.continuation_key ?? null,
  };
}
