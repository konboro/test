import { assistFields } from './assist';
import { extractInvoiceFields, type ExtractedInvoice, type RequiredField } from './fields';

/**
 * Turning an uploaded file into invoice fields.
 *
 * Two routes, and the cheap one is also the accurate one. A PDF produced by
 * accounting software carries its own text, so reading that text is exact and
 * costs nothing — no model, no key, no per-page charge. Only a document with no
 * text layer, which is to say an actual scan or a photo, needs a model to look
 * at it.
 */

export type ReadSource = 'pdf_text' | 'vision' | 'manual';

export interface ReadResult {
  source: ReadSource;
  fields: ExtractedInvoice;
  missing: RequiredField[];
  /** Set when nothing could be read at all, for the review screen to explain. */
  problem?: 'no_text_layer' | 'vision_unavailable' | 'unreadable' | 'too_many_pages';
}

/** Enough characters that this is a document rather than a stray label. */
const MEANINGFUL_TEXT = 40;

/**
 * How many pages of a text-free PDF we will pay a model to read.
 *
 * An invoice is one to three pages. Beyond this the upload is a batch of
 * documents scanned into one file, and the bill is per page — so it stops here
 * and says so rather than quietly costing twenty times what an invoice should.
 */
const MAX_VISION_PAGES = 5;

export function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

/**
 * The embedded text of a PDF, or null when it has none.
 *
 * Loaded lazily so that the parser — a large dependency — is only pulled in on
 * the request that actually uploads a PDF, rather than on every cold start of
 * every route in the app.
 */
export async function pdfText(
  bytes: Uint8Array,
): Promise<{ text: string | null; pages: number }> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });

    const merged = Array.isArray(text) ? text.join('\n') : text;

    return {
      text: merged.trim().length >= MEANINGFUL_TEXT ? merged : null,
      pages: pdf.numPages,
    };
  } catch (cause) {
    // A malformed or encrypted PDF is a normal thing for a person to upload;
    // it becomes a review row asking them to type the fields, not a 500.
    console.error('[invoice-scan] pdf text layer', String(cause));
    return { text: null, pages: 0 };
  }
}

/**
 * Merges what the model supplied into what the labels found.
 *
 * The parser wins every contest. It read the actual document structure; the
 * model read prose about it. Only the blanks are filled, and `missing` is
 * recomputed from the result so the review card stops flagging a field that now
 * has a value.
 */
function merge(
  fields: ExtractedInvoice,
  assisted: Partial<ExtractedInvoice> | null,
): { fields: ExtractedInvoice; missing: RequiredField[] } {
  const merged: ExtractedInvoice = { ...fields };

  if (assisted) {
    for (const [key, value] of Object.entries(assisted) as Array<
      [keyof ExtractedInvoice, ExtractedInvoice[keyof ExtractedInvoice]]
    >) {
      if (merged[key] === null || merged[key] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = value;
      }
    }
  }

  const missing: RequiredField[] = [];
  if (!merged.invoiceNumber) missing.push('invoiceNumber');
  if (merged.amountCents === null) missing.push('amountCents');
  if (!merged.issueDate) missing.push('issueDate');
  if (!merged.vatNumber && !merged.debtorName) missing.push('customer');

  return { fields: merged, missing };
}

/**
 * Reads one uploaded document.
 *
 * `vision` and `assist` are injected rather than imported so that this stays
 * testable without a network, and so the caller decides whether a model may be
 * used at all.
 */
export async function readInvoiceDocument(
  file: { bytes: Uint8Array; mimeType: string },
  options: {
    ownVatNumber?: string | null;
    vision?: (input: { bytes: Uint8Array; mimeType: string }) => Promise<string | null>;
    assist?: (
      text: string,
      missing: ReadonlyArray<RequiredField>,
    ) => Promise<Partial<ExtractedInvoice> | null>;
  } = {},
): Promise<ReadResult> {
  const empty = extractInvoiceFields('', options);

  /**
   * Whatever text was recovered, turned into fields.
   *
   * A label the parser has not been taught used to end here as a blank form for
   * somebody to retype. Now it goes to the model instead — but only the fields
   * that are actually still empty, and only on the documents that need it, so a
   * known layout still costs nothing.
   */
  const finish = async (source: ReadSource, text: string): Promise<ReadResult> => {
    const read = extractInvoiceFields(text, options);
    if (read.missing.length === 0) return { source, ...read };

    const assist = options.assist ?? assistFields;
    return { source, ...merge(read.fields, await assist(text, read.missing)) };
  };

  let pages = 0;

  if (isPdf(file.mimeType)) {
    const read = await pdfText(file.bytes);
    pages = read.pages;

    if (read.text) return finish('pdf_text', read.text);

    if (pages > MAX_VISION_PAGES) {
      return { source: 'manual', ...empty, problem: 'too_many_pages' };
    }
  }

  // An image, or a PDF that is only pictures of a page.
  if (!options.vision) {
    return {
      source: 'manual',
      ...empty,
      problem: isPdf(file.mimeType) ? 'no_text_layer' : 'vision_unavailable',
    };
  }

  const seen = await options.vision(file);
  if (!seen) {
    return { source: 'manual', ...empty, problem: 'unreadable' };
  }

  return finish('vision', seen);
}
