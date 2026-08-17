/**
 * Viva.com Smart Checkout.
 *
 * The creditor's own Viva account takes the money. There is no platform in the
 * middle at all — not even the thin one Stripe Connect puts there — because the
 * only credentials involved belong to the creditor.
 *
 * Two hosts per estate and they are not interchangeable: tokens are minted on
 * `accounts.`, API calls go to `api.`, and the demo estate has its own pair.
 * Demo credentials are rejected by production with `invalid_client`, which is
 * how the settings screen can tell an operator which estate they just pasted.
 */

export type VivaEnvironment = 'demo' | 'production';

export interface VivaCredentials {
  clientId: string;
  clientSecret: string;
  environment: VivaEnvironment;
  /** Null uses the account default source, which is what a fresh account has. */
  sourceCode?: string | null;
}

interface Hosts {
  accounts: string;
  api: string;
  checkout: string;
}

export function hostsFor(environment: VivaEnvironment): Hosts {
  return environment === 'production'
    ? {
        accounts: 'https://accounts.vivapayments.com',
        api: 'https://api.vivapayments.com',
        checkout: 'https://www.vivapayments.com',
      }
    : {
        accounts: 'https://demo-accounts.vivapayments.com',
        api: 'https://demo-api.vivapayments.com',
        checkout: 'https://demo.vivapayments.com',
      };
}

/** Where the debtor is sent to actually pay. */
export function checkoutUrl(environment: VivaEnvironment, orderCode: string | number): string {
  return `${hostsFor(environment).checkout}/web/checkout?ref=${orderCode}`;
}

export class VivaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VivaError';
  }
}

/**
 * Client-credentials token.
 *
 * Deliberately not cached across requests. Tokens last an hour, but this runs on
 * serverless instances that are recycled unpredictably and shared by no one, so
 * a module-level cache would buy one saved round trip in exchange for a class of
 * bug — a stale token surviving a credential rotation — that only shows up in
 * production, on the money path.
 */
export async function accessToken(credentials: VivaCredentials): Promise<string> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
    'base64',
  );

  const response = await fetch(`${hostsFor(credentials.environment).accounts}/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  const body = await response.text();

  if (!response.ok) {
    // `invalid_client` is the one worth naming: it means the credentials are
    // real but belong to the other estate, which is the mistake an operator
    // actually makes.
    const detail = body.includes('invalid_client')
      ? 'invalid_client — the credentials do not belong to this environment'
      : body.slice(0, 200);
    throw new VivaError(`Viva refused the credentials: ${detail}`, response.status);
  }

  const parsed = JSON.parse(body) as { access_token?: string };
  if (!parsed.access_token) throw new VivaError('Viva returned no access token');

  return parsed.access_token;
}

export interface CreateOrderInput {
  /** Minor units, exactly as stored. */
  amountCents: number;
  /** Shown to the customer on the checkout page. */
  customerTrns: string;
  /** Our own reference, visible to the merchant in their Viva sales list. */
  merchantTrns: string;
  customerEmail?: string | null;
  /** Seconds the order stays payable. */
  paymentTimeout?: number;
}

/**
 * Creates a payment order and returns its code.
 *
 * The amount always comes from our database. Nothing a debtor can influence
 * reaches this call.
 */
export async function createOrder(
  credentials: VivaCredentials,
  input: CreateOrderInput,
): Promise<string> {
  const token = await accessToken(credentials);

  const payload: Record<string, unknown> = {
    amount: input.amountCents,
    customerTrns: input.customerTrns,
    merchantTrns: input.merchantTrns,
    paymentTimeout: input.paymentTimeout ?? 1800,
    // Neither belongs on a debt payment: an invoice is settled in full or not at
    // all, and there is nobody to tip.
    disableExactAmount: false,
    allowRecurring: false,
    ...(credentials.sourceCode ? { sourceCode: credentials.sourceCode } : {}),
    ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
  };

  const response = await fetch(`${hostsFor(credentials.environment).api}/checkout/v2/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const body = await response.text();

  if (!response.ok) {
    throw new VivaError(`Viva rejected the order: ${body.slice(0, 200)}`, response.status);
  }

  const parsed = JSON.parse(body) as { orderCode?: number | string };
  if (parsed.orderCode === undefined || parsed.orderCode === null) {
    throw new VivaError('Viva returned no order code');
  }

  return String(parsed.orderCode);
}

export interface VivaTransaction {
  transactionId: string;
  /** Viva's own status code; `F` is the only one that means settled. */
  statusId: string;
  amount: number;
  orderCode: string;
  merchantTrns: string | null;
}

/**
 * Reads a transaction back from Viva.
 *
 * This is the only thing that decides whether money moved. The redirect the
 * debtor arrives on carries a transaction id and nothing else worth trusting —
 * anyone can type one — so it is used as a lookup key and never as evidence.
 */
export async function retrieveTransaction(
  credentials: VivaCredentials,
  transactionId: string,
): Promise<VivaTransaction> {
  const token = await accessToken(credentials);

  const response = await fetch(
    `${hostsFor(credentials.environment).api}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );

  const body = await response.text();

  if (!response.ok) {
    throw new VivaError(`Viva could not return the transaction: ${body.slice(0, 200)}`, response.status);
  }

  const parsed = JSON.parse(body) as {
    transactionId?: string;
    statusId?: string;
    amount?: number;
    orderCode?: number | string;
    merchantTrns?: string;
  };

  return {
    transactionId: parsed.transactionId ?? transactionId,
    statusId: parsed.statusId ?? '',
    amount: typeof parsed.amount === 'number' ? parsed.amount : 0,
    orderCode: parsed.orderCode === undefined ? '' : String(parsed.orderCode),
    merchantTrns: parsed.merchantTrns ?? null,
  };
}

/**
 * Whether a retrieved transaction represents captured money.
 *
 * Viva reports payment state as a single letter and only `F` ("finished") is
 * settled. `A` is captured-pending, `E` is an error, `M`/`X` are various forms
 * of not-yet. Treating anything but `F` as paid would mark invoices settled that
 * can still fail.
 */
export function isSettled(transaction: VivaTransaction): boolean {
  return transaction.statusId === 'F';
}

/**
 * Whether this transaction belongs to the order we created for this invoice.
 *
 * This is the whole binding, and it is deliberately not an amount comparison.
 * The amount is fixed when the order is created — from the database, never from
 * anything a debtor can influence — so Viva can only ever charge what we asked
 * for, and re-checking it proves nothing. Order codes, on the other hand, are
 * ours: we mint one per invoice and store it, so a transaction id lifted from
 * somewhere else fails here even if its amount happens to line up.
 *
 * The units Viva reports a transaction amount in are also unverified — reading
 * an order back is a 404 on this API version, and confirming it needs a demo
 * payment driven through the hosted form. Making settlement depend on an
 * unverified unit would be the wrong risk to take on the money path.
 */
export function belongsToOrder(transaction: VivaTransaction, orderCode: string): boolean {
  return orderCode.length > 0 && transaction.orderCode === orderCode;
}
