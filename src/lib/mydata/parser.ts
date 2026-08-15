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
    root = parser.parse(xml) as Record<string, unknown>;
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
