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
 * Reads one uploaded document.
 *
 * `vision` is injected rather than imported so that this stays testable without
 * a network, and so the caller decides whether a model may be used at all.
 */
export async function readInvoiceDocument(
  file: { bytes: Uint8Array; mimeType: string },
  options: {
    ownVatNumber?: string | null;
    vision?: (input: { bytes: Uint8Array; mimeType: string }) => Promise<string | null>;
  } = {},
): Promise<ReadResult> {
  const empty = extractInvoiceFields('', options);

  let pages = 0;

  if (isPdf(file.mimeType)) {
    const read = await pdfText(file.bytes);
    pages = read.pages;

    if (read.text) {
      const { fields, missing } = extractInvoiceFields(read.text, options);
      return { source: 'pdf_text', fields, missing };
    }

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

  const { fields, missing } = extractInvoiceFields(seen, options);
  return { source: 'vision', fields, missing };
}
