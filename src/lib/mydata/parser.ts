import { XMLParser } from 'fast-xml-parser';

import type { MyDataInvoice, MyDataPage, MyDataParty } from './types';
import { MyDataError } from './types';

const parser = new XMLParser({
  ignoreAttributes: true,
  // myDATA responses are namespaced; strip prefixes so element access is stable
  // regardless of which prefix AADE happens to emit.
  removeNSPrefix: true,
  trimValues: true,
  // Keep everything as strings: MARK values are long numerics that must not be
  // coerced into JS numbers, and monetary values are parsed deliberately below.
  parseTagValue: false,
});

/**
 * Unwraps the envelope AADE's production API actually returns.
 *
 * `RequestTransmittedDocs` does not hand back a bare `<RequestedDoc>`. It returns
 * a WCF string serialisation:
 *
 *   <string xmlns="http://schemas.microsoft.com/2003/10/Serialization/">
 *     &lt;?xml version="1.0"?&gt;&lt;RequestedDoc&gt;…
 *   </string>
 *
 * — the real document, HTML-escaped, as the *text content* of a `<string>`
 * element. Two things follow from that, and both bit us:
 *
 *  1. Parsing the outer document yields `{ string: "<RequestedDoc>…" }`, so the
 *     lookup for `RequestedDoc` finds nothing and every page looks empty.
 *  2. A real page contains tens of thousands of escaped entities, which trips
 *     fast-xml-parser's entity-expansion guard ("76699 > 1000") and aborts the
 *     parse outright.
 *
 * Extracting the payload with a match and decoding it ourselves fixes both: the
 * inner XML is then ordinary markup with no entity storm to expand. A response
 * that is already a bare document is passed through untouched, which is what the
 * sandbox and the unit fixtures return.
 */
function unwrapEnvelope(xml: string): string {
  const match = /<string[^>]*>([\s\S]*)<\/string>/.exec(xml);
  if (!match?.[1]) return xml;

  return (
    match[1]
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&#xD;', '\r')
      .replaceAll('&#xA;', '\n')
      // Last: decoding it earlier would turn a literal `&amp;lt;` in the data
      // into a tag delimiter.
      .replaceAll('&amp;', '&')
  );
}

/** Always returns an array — fast-xml-parser collapses single elements. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Parses a decimal string. myDATA uses `.` as the decimal separator. */
function decimal(value: unknown): number {
  const s = text(value);
  if (s === null) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function party(raw: Record<string, unknown> | undefined): MyDataParty {
  if (!raw) return { vatNumber: null, country: null, branch: null, name: null };

  const branch = text(raw.branch);
  // The `name` sub-element only appears for some document types; when it is
  // missing the caller falls back to the VAT number.
  const nameNode = raw.name as Record<string, unknown> | string | undefined;
  const name =
    typeof nameNode === 'object' && nameNode !== null
      ? text((nameNode as Record<string, unknown>).name ?? null)
      : text(nameNode);

  return {
    vatNumber: text(raw.vatNumber),
    country: text(raw.country),
    branch: branch === null ? null : Number.parseInt(branch, 10),
    name,
  };
}

/**
 * Parses a `RequestedDoc` XML payload into normalised invoices.
 *
 * Tolerates the shape differences between RequestDocs and RequestTransmittedDocs
 * and skips any document that lacks the two fields we cannot work without: a
 * MARK and an issue date.
 */
export function parseRequestedDoc(xml: string): MyDataPage {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(unwrapEnvelope(xml)) as Record<string, unknown>;
  } catch (cause) {
    throw new MyDataError(`myDATA returned XML that could not be parsed: ${String(cause)}`);
  }

  const requestedDoc = (root.RequestedDoc ?? root.requestedDoc) as
    | Record<string, unknown>
    | undefined;

  if (!requestedDoc) {
    // AADE reports application-level failures as a <ResponseDoc> envelope.
    const responseDoc = root.ResponseDoc as Record<string, unknown> | undefined;
    if (responseDoc) {
      throw new MyDataError(`myDATA rejected the request: ${JSON.stringify(responseDoc)}`);
    }
    // An empty result set is a legitimate response, not an error.
    return { invoices: [], continuationToken: null };
  }

  const invoicesDoc = requestedDoc.invoicesDoc as Record<string, unknown> | undefined;
  const rawInvoices = asArray<Record<string, unknown>>(
    invoicesDoc?.invoice as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );

  const invoices: MyDataInvoice[] = [];

  for (const raw of rawInvoices) {
    const header = (raw.invoiceHeader ?? {}) as Record<string, unknown>;
    const summary = (raw.invoiceSummary ?? {}) as Record<string, unknown>;

    const mark = text(raw.mark);
    const issueDate = text(header.issueDate);
    if (!mark || !issueDate) continue;

    invoices.push({
      mark,
      uid: text(raw.uid),
      cancelledByMark: text(raw.cancelledByMark),
      issuer: party(raw.issuer as Record<string, unknown> | undefined),
      counterpart: party(raw.counterpart as Record<string, unknown> | undefined),
      series: text(header.series),
      aa: text(header.aa),
      issueDate,
      invoiceType: text(header.invoiceType),
      currency: text(header.currency) ?? 'EUR',
      totalNetValue: decimal(summary.totalNetValue),
      totalVatAmount: decimal(summary.totalVatAmount),
      totalGrossValue: decimal(summary.totalGrossValue),
    });
  }

  const token = requestedDoc.continuationToken as Record<string, unknown> | undefined;
  const nextPartitionKey = text(token?.nextPartitionKey);
  const nextRowKey = text(token?.nextRowKey);

  return {
    invoices,
    continuationToken:
      nextPartitionKey && nextRowKey ? { nextPartitionKey, nextRowKey } : null,
  };
}
