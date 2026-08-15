import { parseRequestedDoc } from './parser';
import type { MyDataCredentials, MyDataInvoice, MyDataPage } from './types';
import { MyDataError } from './types';

const BASE_URLS = {
  production: 'https://mydatapi.aade.gr/myDATA',
  sandbox: 'https://mydataapidev.aade.gr/myDATA',
} as const;

const REQUEST_TIMEOUT_MS = 30_000;
/** Safety stop so a bad cursor can never spin forever. */
const MAX_PAGES = 50;

function headers(credentials: MyDataCredentials): HeadersInit {
  return {
    // AADE's exact header names. Both are required on every call.
    'aade-user-id': credentials.userId,
    'ocp-apim-subscription-key': credentials.subscriptionKey,
    Accept: 'application/xml',
  };
}

async function call(
  credentials: MyDataCredentials,
  path: string,
  params: Record<string, string>,
): Promise<string> {
  const url = new URL(`${BASE_URLS[credentials.environment]}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: headers(credentials),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new MyDataError('myDATA request timed out after 30s');
    }
    throw new MyDataError(`Could not reach myDATA: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();

  if (!response.ok) {
    // 401/403 almost always means bad credentials — surface that plainly so the
    // settings page can tell the user what to fix.
    const hint =
      response.status === 401 || response.status === 403
        ? 'Check the myDATA User ID and Subscription Key.'
        : '';
    throw new MyDataError(
      `myDATA responded ${response.status} ${response.statusText}. ${hint}`.trim(),
      response.status,
      body.slice(0, 2000),
    );
  }

  return body;
}

/**
 * One page of documents *issued by* the authenticated entity.
 *
 * `RequestTransmittedDocs` is the correct endpoint for accounts receivable:
 * it returns what the tenant invoiced out. (`RequestDocs` returns inbound
 * documents filed against them — that is payables, not our concern.)
 */
export async function fetchTransmittedDocsPage(
  credentials: MyDataCredentials,
  options: { mark?: string; nextPartitionKey?: string; nextRowKey?: string } = {},
): Promise<MyDataPage> {
  const params: Record<string, string> = {
    // `mark` is a watermark, not a filter: AADE returns documents with a MARK
    // greater than this value. '0' means "everything from the beginning".
    mark: options.mark ?? '0',
  };

  if (options.nextPartitionKey && options.nextRowKey) {
    params.nextPartitionKey = options.nextPartitionKey;
    params.nextRowKey = options.nextRowKey;
  }

  const xml = await call(credentials, 'RequestTransmittedDocs', params);
  return parseRequestedDoc(xml);
}

/**
 * Walks every page from `sinceMark` onwards and returns the full set.
 *
 * Callers persist the highest MARK they have seen and pass it back on the next
 * run, so each sync only transfers new documents.
 */
export async function fetchAllTransmittedDocs(
  credentials: MyDataCredentials,
  sinceMark = '0',
): Promise<MyDataInvoice[]> {
  const all: MyDataInvoice[] = [];
  let cursor: MyDataPage['continuationToken'] = null;
  let pages = 0;

  do {
    const page: MyDataPage = await fetchTransmittedDocsPage(credentials, {
      mark: sinceMark,
      ...(cursor
        ? { nextPartitionKey: cursor.nextPartitionKey, nextRowKey: cursor.nextRowKey }
        : {}),
    });

    all.push(...page.invoices);
    cursor = page.continuationToken;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return all;
}

/**
 * Cheap credential check for the settings screen: any non-auth response means
 * the keys are accepted.
 */
export async function verifyCredentials(
  credentials: MyDataCredentials,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fetchTransmittedDocsPage(credentials, { mark: '0' });
    return { ok: true };
  } catch (error) {
    if (error instanceof MyDataError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: String(error) };
  }
}
