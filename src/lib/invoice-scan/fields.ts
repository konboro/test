import { parseAmountCents, parseDate } from '@/lib/import/parse';

/**
 * Reading an invoice document into the fields this product needs.
 *
 * Text in, fields out, no I/O — the hard part here is judgement about Greek
 * invoice layouts, and that is worth being able to test without a PDF, an API
 * key or a network.
 */

export interface ExtractedInvoice {
  debtorName: string | null;
  vatNumber: string | null;
  invoiceNumber: string | null;
  series: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amountCents: number | null;
  currency: string;
  /** The myDATA MARK, when the document carries one. */
  mark: string | null;
}

/**
 * Without these an invoice cannot be created, so the review screen must ask.
 *
 * The customer is one entry rather than two: a document naming either a VAT
 * number or a company name is enough to find or create one, and demanding both
 * would flag a perfectly good invoice.
 */
export const REQUIRED_FIELDS = ['invoiceNumber', 'amountCents', 'issueDate', 'customer'] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/**
 * Accent-stripped, sigma-normalised uppercase, for matching only.
 *
 * Greek invoices are typeset in every combination of case and accent there is,
 * and the final sigma ending ΠΕΛΑΤΗΣ is the same letter as the one in the middle
 * of it. Values are always taken from the original text.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    // The combining marks NFD just split off. Written as escapes rather than as
    // the characters themselves, which are invisible in an editor and survive
    // exactly one careless save.
    .replace(/[̀-ͯ]/g, '')
    .replace(/ς/g, 'σ')
    .toUpperCase();
}

/** Everything after the first match of `label` on that line. */
function tail(line: string, label: RegExp): string {
  const match = label.exec(fold(line));
  if (!match) return '';
  return line.slice(match.index + match[0].length).replace(/^[\s:.\-]+/, '').trim();
}

/**
 * The value for a label, looking on the label's own line and then below it.
 *
 * Both layouts are common and neither is a mistake: a table puts the heading
 * above the value, a form puts it to the left.
 */
function valueFor(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || !label.test(fold(line))) continue;

    const sameLine = tail(line, label);
    if (sameLine) return sameLine;

    for (let j = i + 1; j < Math.min(i + 3, lines.length); j += 1) {
      const below = lines[j]?.trim();
      if (below) return below;
    }
  }

  return null;
}

// --- labels ---------------------------------------------------------------
// Greek first, because that is what the documents are. English too, because a
// Greek company invoicing abroad issues in English and the same reader has to
// cope with both.
//
// Every one of these is written with explicit Unicode lookarounds instead of
// \b. JavaScript's \b is defined against [A-Za-z0-9_], so a Greek letter is not
// a word character and /\bΑΦΜ\b/ matches nothing, ever — silently, because a
// regex that never fires is indistinguishable from a document that never
// mentioned the label.

const VAT_LABEL =
  /(?<![\p{L}\p{N}])(?:Α\.Φ\.Μ\.?|ΑΦΜ|VAT(?:\s*(?:NO|NUMBER|ID|REG))?|TAX\s*ID)(?![\p{L}\p{N}])/u;

const CUSTOMER_MARKER =
  /(ΣΤΟΙΧΕΙΑ\s+ΠΕΛΑΤΗ|ΠΕΛΑΤΗ|ΕΠΩΝΥΜΙΑ|ΠΡΟΣ|BILL\s*TO|INVOICE\s*TO|CUSTOMER|CLIENT)/u;
const ISSUER_MARKER = /(ΣΤΟΙΧΕΙΑ\s+ΕΚΔΟΤΗ|ΕΚΔΟΤΗ|ΠΩΛΗΤΗ|SUPPLIER|SELLER|ISSUER)/u;

const NUMBER_LABEL =
  /(?<![\p{L}\p{N}])(?:ΑΡΙΘΜΟΣ\s+ΤΙΜΟΛΟΓΙΟΥ|ΑΡ\.?\s*ΤΙΜΟΛΟΓΙΟΥ|ΑΡ\.?\s*ΠΑΡΑΣΤΑΤΙΚΟΥ|ΑΡΙΘΜΟΣ|INVOICE\s*(?:NO|NUMBER|#)|DOCUMENT\s*(?:NO|NUMBER))(?![\p{L}\p{N}])/u;

const SERIES_LABEL = /(?<![\p{L}\p{N}])(?:ΣΕΙΡΑ|SERIES)(?![\p{L}\p{N}])/u;

const ISSUE_DATE_LABEL =
  /(?<![\p{L}\p{N}])(?:ΗΜΕΡΟΜΗΝΙΑ\s+ΕΚΔΟΣΗΣ|ΗΜ\/ΝΙΑ\s+ΕΚΔΟΣΗΣ|ΗΜΕΡΟΜΗΝΙΑ|ΗΜ\/ΝΙΑ|ISSUE\s*DATE|INVOICE\s*DATE|DATE)(?![\p{L}\p{N}])/u;

const DUE_DATE_LABEL =
  /(?<![\p{L}\p{N}])(?:ΗΜΕΡΟΜΗΝΙΑ\s+ΛΗΞΗΣ|ΛΗΞΗ|ΠΡΟΘΕΣΜΙΑ(?:\s+ΠΛΗΡΩΜΗΣ)?|DUE\s*DATE|PAYMENT\s*DUE|DUE)(?![\p{L}\p{N}])/u;

const MARK_LABEL = /(?<![\p{L}\p{N}])(?:Μ\.ΑΡ\.Κ\.?|ΜΑΡΚ|MARK)(?![\p{L}\p{N}])/u;

/**
 * Total labels, most specific first.
 *
 * The order is the whole design. A Greek invoice shows net, VAT and total,
 * frequently with the VAT line between them; matching ΣΥΝΟΛΟ first would
 * cheerfully return the net subtotal of a document whose payable amount is 24%
 * higher, and every imported invoice would under-collect by exactly the VAT.
 * What we want is what the customer owes, so a label naming itself payable
 * beats one merely naming itself a sum.
 *
 * `vetoComponents` is off for the specific tiers on purpose. "ΣΥΝΟΛΟ ΜΕ ΦΠΑ"
 * contains ΦΠΑ and *is* the payable amount; a blanket veto on the word would
 * throw away the exact line we came for. The veto exists for the last tier,
 * where a bare ΣΥΝΟΛΟ or TOTAL really might be labelling a subtotal.
 */
const TOTAL_LABELS: ReadonlyArray<{ pattern: RegExp; vetoComponents: boolean }> = [
  {
    pattern:
      /(?<![\p{L}\p{N}])(?:ΠΛΗΡΩΤΕΟ(?:\s+ΠΟΣΟ)?|ΤΕΛΙΚΟ\s+ΣΥΝΟΛΟ|ΓΕΝΙΚΟ\s+ΣΥΝΟΛΟ|AMOUNT\s*DUE|BALANCE\s*DUE|TOTAL\s*DUE|GRAND\s*TOTAL)(?![\p{L}\p{N}])/u,
    vetoComponents: false,
  },
  {
    pattern: /(?<![\p{L}\p{N}])(?:ΣΥΝΟΛΟ\s+ΜΕ\s+ΦΠΑ|ΑΞΙΑ\s+ΜΕ\s+ΦΠΑ)(?![\p{L}\p{N}])/u,
    vetoComponents: false,
  },
  {
    pattern: /(?<![\p{L}\p{N}])(?:ΣΥΝΟΛΙΚΟ\s+ΠΟΣΟ|ΣΥΝΟΛΟ|TOTAL)(?![\p{L}\p{N}])/u,
    vetoComponents: true,
  },
];

/**
 * Lines naming a component of the price rather than the price.
 *
 * Checked before a total label is accepted, and deliberately not applied to the
 * "ΣΥΝΟΛΟ ΜΕ ΦΠΑ" family — that phrase contains ΦΠΑ and names the payable
 * amount, so a blanket veto on the word would reject the very line we want.
 */
const NOT_A_TOTAL =
  /(?<![\p{L}\p{N}])(?:ΚΑΘΑΡΗ\s+ΑΞΙΑ|ΑΞΙΑ\s+ΧΩΡΙΣ|ΜΕΡΙΚΟ\s+ΣΥΝΟΛΟ|ΦΠΑ|ΕΚΠΤΩΣΗ|SUBTOTAL|NET(?:\s+AMOUNT)?|VAT|TAX|DISCOUNT)(?![\p{L}\p{N}])/u;

/** A number that could be money, taken from the end of a line. */
const TRAILING_AMOUNT = /(-?[\d.,]{1,20})\s*(?:€|EUR|ΕΥΡΩ)?\s*$/u;

function currencyIn(text: string): string {
  const folded = fold(text);
  if (/\bUSD\b|\$/.test(folded)) return 'USD';
  if (/\bGBP\b|£/.test(folded)) return 'GBP';
  return 'EUR';
}

/**
 * Every 9-digit number a VAT label points at, in reading order.
 *
 * A Greek VAT number is exactly nine digits, which is also the shape of plenty
 * of other things on an invoice — so nine bare digits are never enough. It has
 * to be nine digits a label introduced.
 */
function vatCandidates(lines: string[]): Array<{ value: string; index: number }> {
  const found: Array<{ value: string; index: number }> = [];

  lines.forEach((line, index) => {
    if (!VAT_LABEL.test(fold(line))) return;

    const after = tail(line, VAT_LABEL) || lines[index + 1] || '';
    const digits = /(?:EL)?(\d{9})(?!\d)/.exec(after.replace(/[\s.]/g, ''));
    if (digits?.[1]) found.push({ value: digits[1], index });
  });

  return found;
}

/**
 * The customer's VAT number, out of the two an invoice carries.
 *
 * The tenant's own number is the reliable half: we know it, so we can remove it
 * and stop guessing. The fallbacks after that are ordered by how much they
 * actually tell us — a number under a customer heading, then one that is not
 * under an issuer heading, then the last on the page, because the letterhead
 * comes first.
 */
function customerVat(lines: string[], ownVatNumber?: string | null): string | null {
  const own = ownVatNumber?.replace(/\D/g, '') ?? '';
  const candidates = vatCandidates(lines).filter((c) => c.value !== own);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]?.value ?? null;

  const nearest = (index: number, marker: RegExp) => {
    for (let i = index; i >= Math.max(0, index - 6); i -= 1) {
      const line = lines[i];
      if (line && marker.test(fold(line))) return true;
    }
    return false;
  };

  const underCustomer = candidates.find((c) => nearest(c.index, CUSTOMER_MARKER));
  if (underCustomer) return underCustomer.value;

  // Only worth applying when the document actually marks an issuer block. With
  // no headings at all every candidate trivially satisfies "not under an issuer
  // heading", and the rule would hand back the first number on the page — which
  // is the letterhead, the one number we are sure is not the customer.
  const anyIssuerMarked = candidates.some((c) => nearest(c.index, ISSUER_MARKER));
  if (anyIssuerMarked) {
    const notIssuer = candidates.find((c) => !nearest(c.index, ISSUER_MARKER));
    if (notIssuer) return notIssuer.value;
  }

  return candidates[candidates.length - 1]?.value ?? null;
}

/** A line that is a name rather than a label, a number or a heading. */
function looksLikeName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return false;
  if (/^\d/.test(trimmed)) return false;

  const folded = fold(trimmed);
  if (VAT_LABEL.test(folded)) return false;
  if (NUMBER_LABEL.test(folded)) return false;
  if (ISSUE_DATE_LABEL.test(folded)) return false;

  return /\p{L}/u.test(trimmed);
}

function customerName(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || !CUSTOMER_MARKER.test(fold(line))) continue;

    const sameLine = tail(line, CUSTOMER_MARKER);
    if (sameLine && looksLikeName(sameLine)) return sameLine;

    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const below = lines[j];
      if (below && looksLikeName(below)) return below.trim();
    }
  }

  return null;
}

/** The payable amount, preferring labels that name themselves payable. */
function totalCents(lines: string[]): number | null {
  for (const { pattern, vetoComponents } of TOTAL_LABELS) {
    // Read upwards: totals sit at the foot of a document, and a word like
    // "total" can appear in a column heading far above the number it labels.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (line === undefined) continue;

      const folded = fold(line);
      if (!pattern.test(folded)) continue;
      if (vetoComponents && NOT_A_TOTAL.test(folded)) continue;

      const onLine = TRAILING_AMOUNT.exec(line.trim());
      const cents = onLine?.[1] ? parseAmountCents(onLine[1]) : null;
      if (cents !== null) return cents;

      const below = lines[i + 1]?.trim();
      const belowCents = below ? parseAmountCents(below) : null;
      if (belowCents !== null) return belowCents;
    }
  }

  return null;
}

function markIn(lines: string[]): string | null {
  const raw = valueFor(lines, MARK_LABEL);
  const digits = raw?.replace(/\D/g, '') ?? '';
  return digits.length >= 15 ? digits.slice(0, 15) : null;
}

/**
 * Reads a document's text into invoice fields.
 *
 * Never throws, and never guesses past what it found: a field it cannot read
 * comes back null and is named in `missing`. A confident blank in a review
 * screen is worse than an obvious gap — the gap gets filled in, the blank gets
 * confirmed.
 */
export function extractInvoiceFields(
  text: string,
  options: { ownVatNumber?: string | null } = {},
): { fields: ExtractedInvoice; missing: RequiredField[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/ /g, ' ').trimEnd())
    .filter((line) => line.trim() !== '');

  const dueDateRaw = valueFor(lines, DUE_DATE_LABEL);

  const fields: ExtractedInvoice = {
    debtorName: customerName(lines),
    vatNumber: customerVat(lines, options.ownVatNumber),
    invoiceNumber: valueFor(lines, NUMBER_LABEL),
    series: valueFor(lines, SERIES_LABEL),
    issueDate: parseDate(valueFor(lines, ISSUE_DATE_LABEL) ?? ''),
    dueDate: dueDateRaw ? parseDate(dueDateRaw) : null,
    amountCents: totalCents(lines),
    currency: currencyIn(text),
    mark: markIn(lines),
  };

  const missing: RequiredField[] = [];
  if (!fields.invoiceNumber) missing.push('invoiceNumber');
  if (fields.amountCents === null) missing.push('amountCents');
  if (!fields.issueDate) missing.push('issueDate');
  if (!fields.vatNumber && !fields.debtorName) missing.push('customer');

  return { fields, missing };
}
