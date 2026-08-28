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
 * A gap wide enough to be a column boundary rather than a word space.
 *
 * In PDF units at invoice body sizes a word space is about three. Twelve is far
 * above anything a sentence produces and far below the run of empty page that
 * separates a Sprzedawca block from a Nabywca one.
 */
const COLUMN_GAP = 12;

/** A gap wide enough to be a space at all. */
const WORD_GAP = 1;

/**
 * The text of a PDF with its columns still distinguishable.
 *
 * A text layer has coordinates; the usual way of flattening it does not use
 * them, and two columns printed side by side come out joined by a single space:
 * "ACME Software Sp. z o.o. Kowalski Transport Sp. z o.o." is one line with no
 * way left to tell where the seller ends and the buyer begins. Rebuilding the
 * lines from the item positions keeps that boundary as a run of spaces, which
 * is the difference between reading a debtor and reading two companies glued
 * together.
 *
 * Returns null if the document does not expose positions, so the caller can
 * fall back to the ordinary extraction.
 */
async function positionedText(pdf: {
  numPages: number;
  getPage?: (page: number) => Promise<unknown>;
}): Promise<string | null> {
  if (typeof pdf.getPage !== 'function') return null;

  const pages: string[] = [];

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = (await pdf.getPage(n)) as {
      getTextContent?: (options?: { disableCombineTextItems?: boolean }) => Promise<{
        items: Array<{ str?: string; width?: number; transform?: number[] }>;
      }>;
    };
    if (typeof page.getTextContent !== 'function') return null;

    // Without this pdf.js merges neighbouring runs into one item and puts a
    // single space where the gap was, discarding the very coordinates that tell
    // a column boundary from a word space.
    const { items } = await page.getTextContent({ disableCombineTextItems: true });

    // Group by baseline. Rounding absorbs the sub-unit drift that superscripts
    // and mixed font sizes put on a line that reads as straight.
    const rows = new Map<number, Array<{ x: number; width: number; text: string }>>();

    for (const item of items) {
      const text = item.str ?? '';
      if (text === '') continue;

      const x = item.transform?.[4] ?? 0;
      const y = Math.round(item.transform?.[5] ?? 0);

      const row = rows.get(y) ?? [];
      row.push({ x, width: item.width ?? 0, text });
      rows.set(y, row);
    }

    // The left edge of the page, as this document actually uses it. A row that
    // starts well to the right of it is in a second column, and that is the only
    // thing left to say so once the row is flattened into a line — a phone
    // number on its own line is otherwise indistinguishable from the issuer's.
    const leftEdge = Math.min(
      ...[...rows.values()].map((row) =>
        Math.min(...row.filter((piece) => piece.text.trim() !== '').map((piece) => piece.x)),
      ),
    );

    const lines = [...rows.entries()]
      .sort(([a], [b]) => b - a)
      .map(([, row]) => {
        const sorted = row.sort((a, b) => a.x - b.x);

        const first = sorted.find((piece) => piece.text.trim() !== '');
        const indent = first && first.x - leftEdge >= COLUMN_GAP ? '    ' : '';

        return sorted.reduce((line, piece, i) => {
          // pdf.js represents a run of empty page as an item whose text is one
          // space and whose width is the whole gap. That width is the only thing
          // left that distinguishes two columns from two words, so it decides.
          if (piece.text.trim() === '') {
            if (line === '') return line;
            return line + (piece.width >= COLUMN_GAP ? '    ' : ' ');
          }

          if (i === 0) return piece.text;

          const previous = sorted[i - 1];
          const gap = piece.x - ((previous?.x ?? 0) + (previous?.width ?? 0));
          const spacing = gap >= COLUMN_GAP ? '    ' : gap >= WORD_GAP ? ' ' : '';

          return line + spacing + piece.text;
        }, indent);
      });

    pages.push(lines.join('\n'));
  }

  const text = pages.join('\n');
  return text.trim() === '' ? null : text;
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

    // A copy, because pdf.js takes ownership of what it is given and leaves the
    // caller holding a detached, empty array. The caller needs those bytes
    // afterwards: a PDF with no text layer goes on to the model, and it was
    // being sent zero bytes — "PDF cannot be empty", every scan, silently
    // reported to the operator as unreadable.
    const pdf = await getDocumentProxy(bytes.slice());

    // Positions first, because they are what keeps two columns apart. The plain
    // extraction stays as the fallback: it is what every other layout has been
    // read with, and a PDF that will not give up its coordinates still has text.
    const positioned = await positionedText(pdf).catch(() => null);

    let merged = positioned;
    if (merged === null) {
      const { text } = await extractText(pdf, { mergePages: true });
      merged = Array.isArray(text) ? text.join('\n') : text;
    }

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
    ownName?: string | null;
    ownEmail?: string | null;
    ownPhone?: string | null;
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

    // A missing name is not a missing field — a tax number alone is enough to
    // raise the invoice. It is still the only part of a debtor a person reads in
    // a list, so it is worth the same question.
    const gaps: RequiredField[] = read.fields.debtorName
      ? read.missing
      : [...new Set<RequiredField>([...read.missing, 'customer'])];

    if (gaps.length === 0) return { source, ...read };

    const assist = options.assist ?? assistFields;
    return { source, ...merge(read.fields, await assist(text, gaps)) };
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
