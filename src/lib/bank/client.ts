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

import { createSign } from 'node:crypto';

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
  debtor_account?: { iban?: string };
  creditor?: { name?: string };
}

export interface IncomingCredit {
  providerTxId: string;
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
export function toCredit(raw: RawTransaction): IncomingCredit | null {
  const providerTxId = raw.entry_reference ?? raw.transaction_id;
  const amount = raw.transaction_amount?.amount;
  const currency = raw.transaction_amount?.currency;
  const bookedOn = raw.booking_date ?? raw.value_date;

  if (!providerTxId || !amount || !currency || !bookedOn) return null;
  if (raw.credit_debit_indicator && raw.credit_debit_indicator !== 'CRDT') return null;

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
    counterpartyName: raw.debtor?.name?.trim() || null,
    counterpartyIban: raw.debtor_account?.iban?.trim() || null,
  };
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
): Promise<{ credits: IncomingCredit[]; fetched: number; continuationKey: string | null }> {
  const query = new URLSearchParams({ date_from: since, transaction_status: 'BOOK' });
  if (continuationKey) query.set('continuation_key', continuationKey);

  const body = await call<{ transactions?: RawTransaction[]; continuation_key?: string }>(
    `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`,
  );

  const raw = body.transactions ?? [];

  return {
    credits: raw.map(toCredit).filter((c): c is IncomingCredit => c !== null),
    // How many the bank returned, before anything was dropped. `toCredit`
    // returns null whenever a field it needs is missing, so a schema that does
    // not match would discard every row and look exactly like an empty account.
    // This one number tells those two apart, which is otherwise unanswerable
    // without the provider credentials in hand.
    fetched: raw.length,
    continuationKey: body.continuation_key ?? null,
  };
}
