/**
 * Revolut Merchant API — hosted checkout.
 *
 * The creditor's own Revolut Business merchant account takes the money, using
 * a secret key they paste into settings. Same arrangement as the Viva
 * credentials and the tenant-owned Stripe key: no platform in the middle, and
 * nothing settles to lefta.
 *
 * Two hosts, one per estate, and a key belongs to exactly one of them — the
 * other answers 401. That is what lets the settings screen detect the estate by
 * trying rather than asking the operator to restate what they already pasted.
 *
 * Deliberately server-side only. Revolut also offers a browser widget, which we
 * do not use: the payment page a debtor lands on carries no third-party script,
 * no cookies and no analytics, and that is worth more than the conversion the
 * widget might add.
 */

export type RevolutEnvironment = 'sandbox' | 'production';

export interface RevolutCredentials {
  secretKey: string;
  environment: RevolutEnvironment;
}

/**
 * The Merchant API is versioned by date and the header is mandatory — omit it
 * and every call fails. Pinned rather than floating: a new version can change
 * response shapes, and this one is on the money path.
 */
const API_VERSION = '2024-09-01';

export function hostFor(environment: RevolutEnvironment): string {
  return environment === 'production'
    ? 'https://merchant.revolut.com'
    : 'https://sandbox-merchant.revolut.com';
}

export class RevolutError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RevolutError';
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

async function call(
  credentials: RevolutCredentials,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${hostFor(credentials.environment)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${credentials.secretKey}`,
        'Revolut-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new RevolutError('Revolut did not answer in time');
    }
    throw new RevolutError(`Could not reach Revolut: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();

  if (!response.ok) {
    // 401 is the one worth naming: it means the key is real but belongs to the
    // other estate, or has been revoked — the mistake an operator actually
    // makes.
    const detail =
      response.status === 401
        ? 'the key was rejected — check it belongs to this environment'
        : body.slice(0, 200);
    throw new RevolutError(`Revolut responded ${response.status}: ${detail}`, response.status);
  }

  return body ? (JSON.parse(body) as unknown) : null;
}

export interface CreateOrderInput {
  /** Minor units, exactly as stored. */
  amountCents: number;
  currency: string;
  /** Shown to the customer on the hosted checkout page. */
  description: string;
  /** Our own reference, visible to the merchant in their Revolut dashboard. */
  reference: string;
  customerEmail?: string | null;
  /** Where Revolut sends the debtor back. Per order — unlike Viva. */
  redirectUrl: string;
}

export interface RevolutOrder {
  id: string;
  /** Where the debtor is sent to pay. */
  checkoutUrl: string | null;
  state: string;
  /** Minor units, as Revolut records them. */
  amount: number | null;
  currency: string | null;
  /** Echoed back from `merchant_order_data.reference` — our invoice id. */
  reference: string | null;
}

function toOrder(raw: unknown): RevolutOrder {
  const body = (raw ?? {}) as {
    id?: string;
    checkout_url?: string;
    state?: string;
    amount?: number;
    order_amount?: { value?: number; currency?: string };
    currency?: string;
    merchant_order_data?: { reference?: string };
  };

  return {
    id: String(body.id ?? ''),
    checkoutUrl: body.checkout_url ?? null,
    // Lower-cased: the field is documented lower-case ("pending", "completed"),
    // but a state that arrived shouting must not silently read as unpaid.
    state: String(body.state ?? '').toLowerCase(),
    amount:
      typeof body.amount === 'number'
        ? body.amount
        : typeof body.order_amount?.value === 'number'
          ? body.order_amount.value
          : null,
    currency: body.currency ?? body.order_amount?.currency ?? null,
    reference: body.merchant_order_data?.reference ?? null,
  };
}

/**
 * Creates a hosted-checkout order and returns it.
 *
 * The amount always comes from our database. Nothing a debtor can influence
 * reaches this call.
 */
export async function createOrder(
  credentials: RevolutCredentials,
  input: CreateOrderInput,
): Promise<RevolutOrder> {
  const order = toOrder(
    await call(credentials, '/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountCents,
        currency: input.currency.toUpperCase(),
        description: input.description,
        redirect_url: input.redirectUrl,
        merchant_order_data: { reference: input.reference },
        ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
      }),
    }),
  );

  if (!order.id) throw new RevolutError('Revolut returned an order without an id');
  return order;
}

/**
 * Reads an order back.
 *
 * This is the only thing that decides whether money moved. The redirect the
 * debtor arrives on proves nothing — anyone can type a URL — so it is used as a
 * lookup key and never as evidence.
 */
export async function retrieveOrder(
  credentials: RevolutCredentials,
  orderId: string,
): Promise<RevolutOrder> {
  return toOrder(await call(credentials, `/api/orders/${encodeURIComponent(orderId)}`));
}

/**
 * Whether a retrieved order represents captured money.
 *
 * `completed` is a payment captured and settled under automatic capture, which
 * is the mode every order we create uses. `authorised` means the money is held
 * but not captured — real, but not ours yet, so it is deliberately not treated
 * as paid: an authorisation can still be cancelled or expire.
 */
export function isPaid(order: RevolutOrder): boolean {
  return order.state === 'completed';
}

/**
 * Whether this order is the one we minted for this invoice.
 *
 * The reference is ours — we set it to the invoice id when creating the order —
 * so an order id lifted from somewhere else fails here even if it is genuinely
 * paid. An order that carries no reference at all fails too: unverifiable is
 * not the same as valid.
 */
export function belongsToInvoice(order: RevolutOrder, invoiceId: string): boolean {
  return Boolean(order.reference) && order.reference === invoiceId;
}

/**
 * Cheapest possible proof that a key works, for the settings screen.
 *
 * Listing orders touches no money and creates nothing. A 401 means the key is
 * wrong for this estate, which is exactly what the caller wants to know.
 */
export async function verifyKey(credentials: RevolutCredentials): Promise<void> {
  await call(credentials, '/api/orders?limit=1');
}
