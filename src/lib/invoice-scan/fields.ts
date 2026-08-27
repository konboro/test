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
    .toUpperCase()
    // Ł is a letter in its own right, not L with a mark, so NFD leaves it alone
    // and every Polish label containing it would miss. PŁATNOŚCI folds to
    // PLATNOSCI only because of this line.
    .replace(/Ł/g, 'L');
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
// Greek and English because that is what the product sells into. Polish,
// German, French, Italian, Spanish and Romanian because an invoice book does
// not respect the market a tool was built for — the first real document that
// arrived here was Polish, and it read as a blank form.
//
// Written as regex literals with explicit Unicode lookarounds, never as strings
// passed to `new RegExp`. Two reasons, both learned the hard way. JavaScript's
// \b is ASCII-only, so /\bΑΦΜ\b/ and /\bNIP\b/ can never match. And in a string
// literal '\s' is simply 's', so a pattern built that way turns
// DATA\s+WYSTAWIENIA into DATAs+WYSTAWIENIA — a regex that compiles, never
// fires, and looks exactly like a document that did not mention the label.

const VAT_LABEL =
  /(?<![\p{L}\p{N}])(?:Α\.Φ\.Μ\.?|ΑΦΜ|VAT(?:\s*(?:NO|NUMBER|ID|REG))?|TAX\s*ID|NIP|UST-?IDNR\.?|STEUERNUMMER|TVA|P\.?\s*IVA|PARTITA\s*IVA|CIF|NIF|CUI)(?![\p{L}\p{N}])/u;

// ΠΕΛΑΤΗΣ, not ΠΕΛΑΤΗ. Greek inflects, and a boundary after the stem rejects
// the nominative outright — the commonest spelling of the word on an invoice.
const CUSTOMER_MARKER =
  /(?<![\p{L}\p{N}])(?:ΣΤΟΙΧΕΙΑ\s+ΠΕΛΑΤΗ|ΠΕΛΑΤΗΣ|ΠΕΛΑΤΗ|ΕΠΩΝΥΜΙΑ|ΠΡΟΣ|BILL\s*TO|INVOICE\s*TO|CUSTOMER|CLIENT|NABYWCA|ODBIORCA|KUPUJACY|KUNDE|EMPFANGER|CLIENTE|DESTINATARIO|CUMPARATOR)(?![\p{L}\p{N}])/u;

const ISSUER_MARKER =
  /(?<![\p{L}\p{N}])(?:ΣΤΟΙΧΕΙΑ\s+ΕΚΔΟΤΗ|ΕΚΔΟΤΗΣ|ΕΚΔΟΤΗ|ΠΩΛΗΤΗΣ|ΠΩΛΗΤΗ|ΑΠΟ|SUPPLIER|SELLER|ISSUER|SPRZEDAWCA|WYSTAWCA|VERKAUFER|LIEFERANT|FOURNISSEUR|VENDEUR|FORNITORE|PROVEEDOR|FURNIZOR)(?![\p{L}\p{N}])/u;

// `#` earns its place: Elorus, and most invoicing tools that grew out of one,
// print "ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ #10000-42" with no labelled number at all.
const NUMBER_LABEL =
  /(?<![\p{L}\p{N}])(?:ΑΡΙΘΜΟΣ\s+ΤΙΜΟΛΟΓΙΟΥ|ΑΡ\.?\s*ΤΙΜΟΛΟΓΙΟΥ|ΑΡ\.?\s*ΠΑΡΑΣΤΑΤΙΚΟΥ|ΑΡΙΘΜΟΣ|INVOICE\s*(?:NO|NUMBER|#)|DOCUMENT\s*(?:NO|NUMBER)|FAKTURA\s*VAT|NR\s*FAKTURY|FAKTURA|RACHUNEK|RECHNUNGSNUMMER|RECHNUNG\s*NR\.?|RECHNUNG|FACTURE\s*N|FATTURA\s*N|FATTURA|FACTURA\s*N|FACTURA)(?![\p{L}\p{N}])|#/u;

const SERIES_LABEL = /(?<![\p{L}\p{N}])(?:ΣΕΙΡΑ|SERIES|SERIA|SERIE)(?![\p{L}\p{N}])/u;

const ISSUE_DATE_LABEL =
  /(?<![\p{L}\p{N}])(?:ΗΜΕΡΟΜΗΝΙΑ\s+ΕΚΔΟΣΗΣ|ΗΜ\/ΝΙΑ\s+ΕΚΔΟΣΗΣ|ΗΜΕΡΟΜΗΝΙΑ|ΗΜ\/ΝΙΑ|DATA\s+WYSTAWIENIA|RECHNUNGSDATUM|AUSSTELLUNGSDATUM|DATE\s+DE\s+FACTURATION|FECHA\s+DE\s+EMISION|ISSUE\s*DATE|INVOICE\s*DATE|DATA\s+SPRZEDAZY|DATA\s+FATTURA|DATE|DATA|DATUM|FECHA)(?![\p{L}\p{N}])/u;

// ΕΞΟΦΛΗΣΗ ΕΩΣ is what Elorus prints. ΕΩΣ alone is deliberately last: it means
// "until" and turns up in date ranges that are not a payment deadline.
const DUE_DATE_LABEL =
  /(?<![\p{L}\p{N}])(?:ΗΜΕΡΟΜΗΝΙΑ\s+ΛΗΞΗΣ|ΕΞΟΦΛΗΣΗ\s+ΕΩΣ|ΠΛΗΡΩΜΗ\s+ΕΩΣ|ΛΗΞΗ|ΠΡΟΘΕΣΜΙΑ(?:\s+ΠΛΗΡΩΜΗΣ)?|TERMIN\s+PLATNOSCI|TERMIN\s+ZAPLATY|FALLIGKEITSDATUM|ZAHLBAR\s+BIS|DATE\s+ECHEANCE|DUE\s*DATE|PAYMENT\s*DUE|DUE|SCADENZA|VENCIMIENTO|SCADENT)(?![\p{L}\p{N}])/u;

const MARK_LABEL = /(?<![\p{L}\p{N}])(?:Μ\.ΑΡ\.Κ\.?|ΜΑΡΚ|MARK)(?![\p{L}\p{N}])/u;

/**
 * Total labels, most specific first.
 *
 * The order is the whole design, and a real Greek invoice shows why: it prints
 * "Συνολική καθαρή αξία: 137,10€", then the tax, then "Τελική αξία: 170,00€".
 * The net line is the one that reads most like a total, sits above the real one,
 * and is 24% wrong. What we want is what the customer owes, so a label naming
 * itself final or payable beats one merely naming a sum.
 */
const TOTAL_LABELS: ReadonlyArray<{ pattern: RegExp; vetoComponents: boolean }> = [
  {
    pattern:
      /(?<![\p{L}\p{N}])(?:ΠΛΗΡΩΤΕΟ(?:\s+ΠΟΣΟ)?|ΠΛΗΡΩΤΕΑ\s+ΑΞΙΑ|ΤΕΛΙΚΗ\s+ΑΞΙΑ|ΤΕΛΙΚΟ\s+ΣΥΝΟΛΟ|ΓΕΝΙΚΟ\s+ΣΥΝΟΛΟ|AMOUNT\s*DUE|BALANCE\s*DUE|TOTAL\s*DUE|GRAND\s*TOTAL|DO\s+ZAPLATY|RAZEM\s+DO\s+ZAPLATY|KWOTA\s+DO\s+ZAPLATY|ZAHLBETRAG|GESAMTBETRAG|RECHNUNGSBETRAG|NET\s*A\s*PAYER|TOTALE\s+DA\s+PAGARE|TOTAL\s+A\s+PAGAR|TOTAL\s+DE\s+PLATA)(?![\p{L}\p{N}])/u,
    vetoComponents: false,
  },
  {
    pattern:
      /(?<![\p{L}\p{N}])(?:ΣΥΝΟΛΟ\s+ΜΕ\s+ΦΠΑ|ΑΞΙΑ\s+ΜΕ\s+ΦΠΑ|WARTOSC\s+BRUTTO|SUMA\s+BRUTTO|BRUTTO|GESAMT\s+BRUTTO|TOTALE\s+IVA\s+INCLUSA)(?![\p{L}\p{N}])/u,
    vetoComponents: false,
  },
  {
    pattern:
      /(?<![\p{L}\p{N}])(?:ΣΥΝΟΛΙΚΟ\s+ΠΟΣΟ|ΣΥΝΟΛΟ|TOTAL|RAZEM|SUMA|GESAMT|TOTALE|IMPORTE)(?![\p{L}\p{N}])/u,
    vetoComponents: true,
  },
];

/**
 * Lines naming a component of the price rather than the price.
 *
 * Consulted only for the generic tier above, where a bare "total" really might
 * be labelling a subtotal. ΚΑΘΑΡΗ ΑΞΙΑ covers the Greek net line whether or not
 * ΣΥΝΟΛΙΚΗ precedes it.
 */
const NOT_A_TOTAL =
  /(?<![\p{L}\p{N}])(?:ΚΑΘΑΡΗ\s+ΑΞΙΑ|ΑΞΙΑ\s+ΧΩΡΙΣ|ΜΕΡΙΚΟ\s+ΣΥΝΟΛΟ|ΦΠΑ|ΕΚΠΤΩΣΗ|SUBTOTAL|NET(?:\s+AMOUNT)?|VAT|TAX|DISCOUNT|NETTO|WARTOSC\s+NETTO|PODSTAWA|RABAT|ZWISCHENSUMME|MWST|IMPONIBILE|IVA|TVA)(?![\p{L}\p{N}])/u;

/**
 * A money amount at the end of a line.
 *
 * The inner class admits spaces, because half of Europe groups thousands with
 * one: "1 230,00" is a single number, and a pattern that stops at the space
 * reads it as 230,00 — the same invoice, off by a factor of a thousand, with
 * nothing on screen to suggest anything went wrong. Must end in a digit, so a
 * trailing separator cannot be swallowed.
 */
const TRAILING_AMOUNT = /(-?[\d.,   ]{0,24}\d)\s*(?:€|EUR|ΕΥΡΩ|PLN|ZL|RON|LEI|CZK|HUF|BGN)?\s*$/u;

/** Currency codes we can name, checked against the whole document. */
const CURRENCIES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'PLN', pattern: /(?<![\p{L}\p{N}])(?:PLN|ZL|ZLOTY|ZLOTYCH)(?![\p{L}\p{N}])/u },
  { code: 'RON', pattern: /(?<![\p{L}\p{N}])(?:RON|LEI)(?![\p{L}\p{N}])/u },
  { code: 'CZK', pattern: /(?<![\p{L}\p{N}])CZK(?![\p{L}\p{N}])/u },
  { code: 'HUF', pattern: /(?<![\p{L}\p{N}])HUF(?![\p{L}\p{N}])/u },
  { code: 'BGN', pattern: /(?<![\p{L}\p{N}])BGN(?![\p{L}\p{N}])/u },
  { code: 'USD', pattern: /(?<![\p{L}\p{N}])USD(?![\p{L}\p{N}])/u },
  { code: 'GBP', pattern: /(?<![\p{L}\p{N}])GBP(?![\p{L}\p{N}])/u },
];

function currencyIn(text: string): string {
  const folded = fold(text);
  if (/\$/.test(text)) return 'USD';
  if (/£/.test(text)) return 'GBP';

  for (const { code, pattern } of CURRENCIES) {
    if (pattern.test(folded)) return code;
  }

  return 'EUR';
}

/**
 * Every tax number on the page, with where on its line each one sits.
 *
 * The position matters because an invoice printed in two columns extracts as one
 * line per row: "NIP 5252445111      NIP 6772391626" is the seller and the buyer
 * side by side. Reading only the first match per line made the buyer invisible,
 * left a single candidate standing, and quietly returned the company that issued
 * the invoice as the one that owes money.
 */
function vatCandidates(
  lines: string[],
): Array<{ value: string; index: number; offset: number }> {
  const found: Array<{ value: string; index: number; offset: number }> = [];
  const label = new RegExp(VAT_LABEL.source, 'gu');

  lines.forEach((line, index) => {
    const hits = [...fold(line).matchAll(label)];

    hits.forEach((hit, k) => {
      const start = (hit.index ?? 0) + hit[0].length;
      // Stop at the next label so a number is never read out of the neighbouring
      // column, which is the seller's.
      const stop = hits[k + 1]?.index ?? line.length;
      const sameLine = line.slice(start, stop);

      // A label alone on its line has its number underneath. Only when it is the
      // line's only label: in a two-column row an empty half means that column
      // has no number, not that it borrowed the row below.
      const window =
        sameLine.trim() === '' && hits.length === 1 ? (lines[index + 1] ?? '') : sameLine;

      const digits = /(?:EL|PL|DE|FR|IT|ES|RO|BG|CZ|HU)?(\d{8,12})(?!\d)/.exec(
        window.replace(/[\s.-]/g, ''),
      );
      if (digits?.[1]) found.push({ value: digits[1], index, offset: start });
    });
  });

  return found;
}

type Side = 'left' | 'right';

/**
 * Which half of the page the customer block occupies, when there are two.
 *
 * Polish invoices in particular print Sprzedawca and Nabywca beside each other,
 * and the text layer flattens that into one line per row. The heading row is the
 * only place the order is stated, so it decides which half of the rows under it
 * belongs to the customer. No heading row carrying both means one column, and
 * the ordinary rules apply.
 */
function customerSide(lines: string[]): Side | null {
  for (const line of lines) {
    const folded = fold(line);
    const customer = CUSTOMER_MARKER.exec(folded);
    const issuer = ISSUER_MARKER.exec(folded);
    if (customer && issuer) return customer.index > issuer.index ? 'right' : 'left';
  }

  return null;
}

/**
 * The customer's VAT number, out of the two an invoice carries.
 *
 * The tenant's own number is the reliable half: we know it, so we can remove it
 * and stop guessing. The fallbacks after that are ordered by how much they
 * actually tell us — the customer's column of a two-column row, then a number
 * under a customer heading and no issuer heading, then merely under a customer
 * heading, then one that is not under an issuer heading, then the last on the
 * page, because the letterhead comes first.
 */
function customerVat(lines: string[], ownVatNumber?: string | null): string | null {
  const own = ownVatNumber?.replace(/\D/g, '') ?? '';
  const candidates = vatCandidates(lines).filter((c) => c.value !== own);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]?.value ?? null;

  // Two numbers sharing a line is the two-column layout. This has to be decided
  // before the heading rules below, which read downwards and so cannot tell two
  // columns of the same row apart at all.
  const side = customerSide(lines);
  if (side) {
    for (const candidate of candidates) {
      const row = candidates
        .filter((other) => other.index === candidate.index)
        .sort((a, b) => a.offset - b.offset);
      if (row.length < 2) continue;

      const pick = side === 'right' ? row[row.length - 1] : row[0];
      if (pick) return pick.value;
    }
  }

  const nearest = (index: number, marker: RegExp) => {
    for (let i = index; i >= Math.max(0, index - 6); i -= 1) {
      const line = lines[i];
      if (line && marker.test(fold(line))) return true;
    }
    return false;
  };

  const unambiguous = candidates.find(
    (c) => nearest(c.index, CUSTOMER_MARKER) && !nearest(c.index, ISSUER_MARKER),
  );
  if (unambiguous) return unambiguous.value;

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
  // A heading is not a name, and "Sprzedawca" reaching this far is how the
  // seller ends up being dunned for the buyer's debt.
  if (ISSUER_MARKER.test(folded)) return false;
  if (CUSTOMER_MARKER.test(folded)) return false;

  return /\p{L}/u.test(trimmed);
}

function customerName(lines: string[], ownName?: string | null): string | null {
  const side = customerSide(lines);
  const own = ownName ? fold(ownName).replace(/\s+/g, ' ').trim() : '';

  const acceptable = (value: string): string | null => {
    const name = value.trim();
    if (!looksLikeName(name)) return null;
    // Whoever uploaded the document is not the one who owes money on it.
    if (own && fold(name).replace(/\s+/g, ' ').trim() === own) return null;
    return name;
  };

  const columns = (line: string) =>
    line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);

  /** The customer's half of a row, once we know the page has two of them. */
  const half = (line: string): string | null => {
    if (!side) return acceptable(line);

    const parts = columns(line);
    // One segment means the gap between the columns did not survive extraction.
    // Taking the line whole would return the seller glued to the buyer, so this
    // row is skipped and the next one tried instead.
    if (parts.length < 2) return null;
    return acceptable((side === 'right' ? parts[parts.length - 1] : parts[0]) ?? '');
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || !CUSTOMER_MARKER.test(fold(line))) continue;

    // "Nabywca: Jan Kowalski" — the first column after the heading is the name,
    // whatever else the row carries to the right of it.
    const sameLine = columns(tail(line, CUSTOMER_MARKER))[0];
    const named = sameLine ? acceptable(sameLine) : null;
    if (named) return named;

    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const below = lines[j];
      const found = below ? half(below) : null;
      if (found) return found;
    }
  }

  return null;
}

/**
 * Greek month names, by the prefix they all share across their forms.
 *
 * An invoice writes the month as a word far more often than as a number, and in
 * whichever form the template felt like — Αύγ, Αυγ, Αυγούστου. Matching on the
 * folded prefix covers all of them without listing every declension.
 *
 * Longest first, because ΙΟΥΝ and ΙΟΥΛ share three letters with each other.
 */
const GREEK_MONTHS: ReadonlyArray<[string, number]> = [
  ['ΙΟΥΝ', 6],
  ['ΙΟΥΛ', 7],
  ['ΙΑΝ', 1],
  ['ΦΕΒ', 2],
  ['ΜΑΡ', 3],
  ['ΑΠΡ', 4],
  ['ΜΑΙ', 5],
  ['ΑΥΓ', 8],
  ['ΣΕΠ', 9],
  ['ΟΚΤ', 10],
  ['ΝΟΕ', 11],
  ['ΔΕΚ', 12],
];

/**
 * A date in any form these documents actually use.
 *
 * The numeric parser handles what the importer already knew about. This adds the
 * spelled-out Greek form — "12 Αύγ 2026, 11:42" — which is what the invoicing
 * tool this product is built around prints, and which the numeric parser reads
 * as nothing at all. The time is ignored: a due date has no hour.
 */
function parseAnyDate(raw: string | null): string | null {
  if (!raw) return null;

  const numeric = parseDate(raw);
  if (numeric) return numeric;

  const match = /(\d{1,2})\s+([Α-Ω]{3,})\.?,?\s+(\d{4})/u.exec(fold(raw));
  if (!match) return null;

  const name = match[2] ?? '';
  const month = GREEK_MONTHS.find(([prefix]) => name.startsWith(prefix))?.[1];
  if (!month) return null;

  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!day || day > 31) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

      // Folded, because the suffix alternation is uppercase and a Polish invoice
      // writes its currency as 'zł'. Matching the raw line made every amount that
      // shared a line with its label invisible.
      const onLine = TRAILING_AMOUNT.exec(fold(line.trim()));
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
  options: { ownVatNumber?: string | null; ownName?: string | null } = {},
): { fields: ExtractedInvoice; missing: RequiredField[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/ /g, ' ').trimEnd())
    .filter((line) => line.trim() !== '');

  const dueDateRaw = valueFor(lines, DUE_DATE_LABEL);

  const fields: ExtractedInvoice = {
    debtorName: customerName(lines, options.ownName),
    vatNumber: customerVat(lines, options.ownVatNumber),
    invoiceNumber: valueFor(lines, NUMBER_LABEL),
    series: valueFor(lines, SERIES_LABEL),
    issueDate: parseAnyDate(valueFor(lines, ISSUE_DATE_LABEL)),
    dueDate: parseAnyDate(dueDateRaw),
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
