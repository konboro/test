/**
 * Elorus REST API client.
 *
 * Two headers are mandatory on every call: the personal API token, and the
 * organization id. The organization one is easy to miss — it is not part of the
 * URL and its absence produces a flat `403 You do not have permission to perform
 * this action`, indistinguishable from a genuine permissions problem.
 */

const BASE = 'https://api.elorus.com/v1.1';
const REQUEST_TIMEOUT_MS = 30_000;
/** Elorus caps page_size; this is the largest it honours. */
const PAGE_SIZE = 200;
/** Safety stop so a bad cursor can never spin forever. */
const MAX_PAGES = 50;

export interface ElorusCredentials {
  apiKey: string;
  organizationId: string;
}

export class ElorusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ElorusError';
  }
}

interface Page<T> {
  count: number;
  next: string | null;
  results: T[];
}

/** One email on a contact. Elorus stores several and flags one as primary. */
export interface ElorusEmail {
  email: string;
  primary: boolean;
}

export interface ElorusPhone {
  number: string;
  primary: boolean;
}

export interface ElorusContact {
  id: string;
  active: boolean;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  vat_number: string | null;
  is_client: boolean;
  email: ElorusEmail[];
  phones: ElorusPhone[];
}

export interface ElorusInvoice {
  id: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'void';
  /** Human label, e.g. "Απόδειξη παροχής υπηρεσιών #ΑΠΥ-Β-41". */
  representation: string | null;
  number: number | string | null;
  date: string;
  /** The real due date — the thing myDATA never sends. */
  due_date: string | null;
  currency_code: string | null;
  total: string;
  paid: string;
  client: string | null;
  client_display_name: string | null;
  client_email: string | null;
  client_phone_number: string | null;
  client_vat_number: string | null;
  /** Lets an Elorus document be reconciled with one already read from myDATA. */
  mydata_latest_mark: string | null;
  mydata_latest_cancel_mark: string | null;
}

async function call<T>(
  credentials: ElorusCredentials,
  path: string,
  params: Record<string, string> = {},
): Promise<Page<T>> {
  const url = new URL(`${BASE}/${path}/`);
  url.searchParams.set('page_size', String(PAGE_SIZE));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Token ${credentials.apiKey}`,
        'X-Elorus-Organization': credentials.organizationId,
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new ElorusError('Elorus request timed out after 30s');
    }
    throw new ElorusError(`Could not reach Elorus: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 403 is the one worth explaining: it is what both a missing organization id
    // and a role without read access produce, and the two are fixed in
    // different places.
    const hint =
      response.status === 403
        ? 'Check the Organization ID (Settings → Organization) and that the API key’s user may view contacts and invoices.'
        : response.status === 401
          ? 'Check the API key (Elorus → User Profile).'
          : '';

    throw new ElorusError(
      `Elorus responded ${response.status}. ${hint}`.trim(),
      response.status,
    );
  }

  return (await response.json()) as Page<T>;
}

/** Walks every page of a collection. */
async function all<T>(
  credentials: ElorusCredentials,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const collected: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await call<T>(credentials, path, { ...params, page: String(page) });
    collected.push(...body.results);
    if (!body.next) break;
  }

  return collected;
}

export function fetchContacts(credentials: ElorusCredentials): Promise<ElorusContact[]> {
  return all<ElorusContact>(credentials, 'contacts');
}

export function fetchInvoices(credentials: ElorusCredentials): Promise<ElorusInvoice[]> {
  return all<ElorusInvoice>(credentials, 'invoices');
}

/** Cheap credential check for the settings screen. */
export async function verifyCredentials(
  credentials: ElorusCredentials,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await call<unknown>(credentials, 'contacts', { page_size: '1' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
