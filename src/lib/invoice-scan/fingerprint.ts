/**
 * Recognising that two documents came out of the same template.
 *
 * Everything learned about reading invoices has to be learned about a *kind* of
 * invoice — Elorus in Greek, Elorus in English, whatever Epsilon Net prints —
 * because that is the unit a rule is true about. Learning something about a
 * single document teaches nothing; learning something about "all invoices" is
 * how a fix for one supplier breaks another.
 *
 * The signature is the set of structural words a document uses, not its
 * contents. Two invoices from the same supplier differ in every number and
 * agree on every heading, so headings are what identifies the template and
 * amounts, dates and names deliberately play no part.
 *
 * Written to be read by a person as well as matched by a machine: the approval
 * screen has to be able to say which documents a proposed rule would affect,
 * and "a3f9c1" says nothing to anybody.
 */

/**
 * The words that mark out a layout.
 *
 * Kept here rather than derived from the label regexes on purpose. Those change
 * as new templates are taught, and a signature that shifted underneath stored
 * rules would silently detach every rule from the documents it was approved
 * for. This list is a stable vocabulary; adding to it is a deliberate act with
 * a migration behind it.
 */
const MARKERS: ReadonlyArray<[string, RegExp]> = [
  ['from', /(?<![\p{L}\p{N}])(?:ΑΠΟ|FROM|SPRZEDAWCA|ΕΚΔΟΤΗΣ)(?![\p{L}\p{N}])/u],
  ['client', /(?<![\p{L}\p{N}])(?:ΠΕΛΑΤΗΣ|CLIENT|CUSTOMER|NABYWCA|BILL\s*TO)(?![\p{L}\p{N}])/u],
  ['recipient', /(?<![\p{L}\p{N}])(?:ΠΑΡΑΛΗΠΤΗΣ|ΠΑΡΑΛΗΠΤΗ|ODBIORCA)(?![\p{L}\p{N}])/u],
  ['company', /(?<![\p{L}\p{N}])(?:ΕΠΩΝΥΜΙΑ)(?![\p{L}\p{N}])/u],
  ['vat', /(?<![\p{L}\p{N}])(?:ΑΦΜ|Α\.Φ\.Μ\.?|TAX\s*ID|NIP|VAT)(?![\p{L}\p{N}])/u],
  ['docType', /(?<![\p{L}\p{N}])(?:ΕΙΔΟΣ\s+ΠΑΡΑΣΤΑΤΙΚΟΥ)(?![\p{L}\p{N}])/u],
  ['number', /(?<![\p{L}\p{N}])(?:ΑΡΙΘΜΟΣ|NR\s*FAKTURY|INVOICE\s*(?:NO|NUMBER))(?![\p{L}\p{N}])/u],
  ['series', /(?<![\p{L}\p{N}])(?:ΣΕΙΡΑ|SERIES|SERIA)(?![\p{L}\p{N}])/u],
  ['date', /(?<![\p{L}\p{N}])(?:ΗΜΕΡΟΜΗΝΙΑ|DATE|DATA|DATUM)(?![\p{L}\p{N}])/u],
  ['dueDate', /(?<![\p{L}\p{N}])(?:ΕΞΟΦΛΗΣΗ\s+ΕΩΣ|DUE\s*DATE|TERMIN\s+PLATNOSCI)(?![\p{L}\p{N}])/u],
  ['mark', /(?<![\p{L}\p{N}])(?:ΜΑΡΚ|MARK)(?![\p{L}\p{N}])/u],
  ['contact', /(?<![\p{L}\p{N}])(?:ΠΛΗΡΟΦΟΡΙΕΣ\s+ΕΠΙΚΟΙΝΩΝΙΑΣ|CONTACT)(?![\p{L}\p{N}])/u],
  ['netTotal', /(?<![\p{L}\p{N}])(?:ΚΑΘΑΡΗ\s+ΑΞΙΑ|NET\s+TOTAL|WARTOSC\s+NETTO)(?![\p{L}\p{N}])/u],
  ['finalTotal', /(?<![\p{L}\p{N}])(?:ΤΕΛΙΚΗ\s+ΑΞΙΑ|TOTAL|ΣΥΝΟΛΟ|RAZEM)(?![\p{L}\p{N}])/u],
];

/** Structural facts that separate templates sharing a vocabulary. */
const SHAPES: ReadonlyArray<[string, (lines: string[]) => boolean]> = [
  // Two parties printed side by side, which is the thing most often got wrong.
  [
    'twoColumn',
    (lines) =>
      lines.some((line) => /\s{2,}/.test(line) && /(?:ΑΠΟ|FROM|SPRZEDAWCA)/u.test(line.toUpperCase())),
  ],
  // A row of headings over a row of values, rather than label-then-value.
  ['headerTable', (lines) => lines.some((line) => line.split(/\s{2,}/).filter(Boolean).length >= 4)],
];

const NORMALISE = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').toUpperCase();

export interface Fingerprint {
  /** Stable, short, and used for matching. */
  signature: string;
  /** The same thing in words, for the screen that asks a person to approve it. */
  parts: string[];
}

/**
 * A signature for the document's layout.
 *
 * Deterministic and order-independent: the same template produces the same
 * signature whatever the invoice says, and two templates that happen to share a
 * vocabulary are separated by the shape facts.
 */
export function fingerprintOf(text: string): Fingerprint {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const folded = NORMALISE(text);

  const parts: string[] = [];

  for (const [name, pattern] of MARKERS) {
    if (pattern.test(folded)) parts.push(name);
  }

  for (const [name, holds] of SHAPES) {
    if (holds(lines)) parts.push(name);
  }

  return { signature: parts.join('+') || 'bare', parts };
}

/** Whether a document is the kind a rule was approved for. */
export function matchesFingerprint(text: string, signature: string): boolean {
  return fingerprintOf(text).signature === signature;
}
