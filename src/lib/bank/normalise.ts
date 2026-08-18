/**
 * Making a Greek name and a bank statement agree.
 *
 * The debtor is stored as the creditor issued them — `Παπαδόπουλος Γεώργιος`.
 * The bank reports the counterparty in whatever the sending institution put on
 * the wire, which for Greek accounts is almost always Latin capitals produced by
 * a transliteration nobody agreed on: `PAPADOPOULOS`, `PAPADOPULOS`,
 * `CHRISTOS` / `HRISTOS` / `XRISTOS`, `VASILIS` / `BASILIS`.
 *
 * So neither side is compared as written. Both are folded into one reduced
 * spelling, and the fold does not try to be phonetically correct — it only has
 * to be *consistent*, because a rule applied to both sides makes the two forms
 * collide whether or not the result is pronounceable.
 */

const GREEK_TO_LATIN: ReadonlyArray<readonly [RegExp, string]> = [
  // Vowel digraphs first: taken letter by letter, ΟΥ becomes OY and never meets
  // the OU a bank writes — `Παπαδόπουλος` would stop matching `PAPADOPOULOS`.
  [/ΟΥ/g, 'U'],
  [/ΑΥ/g, 'AV'],
  [/ΕΥ/g, 'EV'],
  [/Θ/g, 'TH'],
  [/Ξ/g, 'X'],
  [/Ψ/g, 'PS'],
  [/Χ/g, 'CH'],
  [/Α/g, 'A'],
  [/Β/g, 'V'],
  [/Γ/g, 'G'],
  [/Δ/g, 'D'],
  [/Ε/g, 'E'],
  [/Ζ/g, 'Z'],
  [/Η/g, 'I'],
  [/Ι/g, 'I'],
  [/Κ/g, 'K'],
  [/Λ/g, 'L'],
  [/Μ/g, 'M'],
  [/Ν/g, 'N'],
  [/Ο/g, 'O'],
  [/Π/g, 'P'],
  [/Ρ/g, 'R'],
  // Final sigma uppercases to Σ, so one rule covers σ and ς alike.
  [/Σ/g, 'S'],
  [/Τ/g, 'T'],
  [/Υ/g, 'Y'],
  [/Φ/g, 'F'],
  [/Ω/g, 'O'],
];

/**
 * Applied to both sides, longest sequences first.
 *
 * `MP`/`NT`/`GK` are how Greek writes the b/d/g sounds, and a bank writes them
 * back as plain `B`/`D`/`G`; `B → V` then runs over the result, which is
 * harmless precisely because it also runs over the other side.
 */
const FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/MP/g, 'B'],
  [/NT/g, 'D'],
  [/GK/g, 'G'],
  [/CH/g, 'X'],
  [/KH/g, 'X'],
  [/PH/g, 'F'],
  [/OU/g, 'U'],
  [/B/g, 'V'],
  [/Y/g, 'I'],
  // Χ reaches us as CH, KH, X or a bare H (`CHRISTOS` / `HRISTOS` / `XRISTOS`).
  // The digraphs above have already been consumed, so whatever H is left folds
  // too. It also turns TH into TX — on both sides, which is all that matters.
  [/H/g, 'X'],
];

/**
 * Legal-form suffixes. Every Greek company name carries one, so leaving them in
 * would make `ALPHA AE` and `BETA AE` share a token.
 */
const LEGAL_FORMS = new Set(['AE', 'EPE', 'IKE', 'OE', 'EE', 'SA', 'LTD', 'MONOPROSOPIKI']);

/** Shortest token still specific enough to stand as evidence on its own. */
const MIN_TOKEN = 4;

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** One name reduced to the tokens worth comparing. */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let value = stripDiacritics(raw.toUpperCase());
  for (const [pattern, replacement] of GREEK_TO_LATIN) value = value.replace(pattern, replacement);
  for (const [pattern, replacement] of FOLDS) value = value.replace(pattern, replacement);

  return value
    .split(/[^A-Z]+/)
    .filter((token) => token.length >= MIN_TOKEN && !LEGAL_FORMS.has(token))
    // A doubled letter survives one spelling and not the other (ΑΛΛΑΓΗ vs ALAGI).
    .map((token) => token.replace(/(.)\1+/g, '$1'));
}

/**
 * True when the two names share a token substantial enough to mean something.
 *
 * Deliberately not a similarity score: a threshold invites tuning, and every
 * value below 1.0 is a decision to sometimes settle the wrong invoice.
 */
export function namesAgree(debtor: string | null, counterparty: string | null): boolean {
  const left = nameTokens(debtor);
  if (!left.length) return false;

  const right = new Set(nameTokens(counterparty));
  return left.some((token) => right.has(token));
}

/**
 * Remittance text as a list of comparable tokens.
 *
 * Tokenised rather than flattened, because an invoice number is short: searching
 * for `1042` inside a run of digits would match a date, an amount or another
 * document's number. As a token it has to stand on its own.
 */
export function referenceTokens(remittance: string | null | undefined): Set<string> {
  if (!remittance) return new Set();

  return new Set(
    stripDiacritics(remittance.toUpperCase())
      .split(/[^A-Z0-9]+/)
      .filter(Boolean)
      .map(stripLeadingZeros),
  );
}

function stripLeadingZeros(token: string): string {
  return /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, '') : token;
}

/**
 * Whether the remittance names this document.
 *
 * `series` and `number` are also tried concatenated, because a payer copying
 * "ΤΠΥ 1042" off the invoice may type it either way. The MARK stays a string
 * throughout — it is 15 digits and would lose its tail as a JS number.
 */
export function referenceMatches(
  remittance: string | null | undefined,
  document: { invoiceNumber: string | null; series: string | null; mark: string | null },
): boolean {
  const tokens = referenceTokens(remittance);
  if (!tokens.size) return false;

  // Reduced the same way the remittance was, so a Greek series (`ΤΠΥ 1042`)
  // degrades to the number rather than becoming an unmatchable string — the
  // tokeniser keeps only A-Z0-9, and Greek letters survive neither side.
  const reduce = (value: string) =>
    stripLeadingZeros(stripDiacritics(value.toUpperCase()).replace(/[^A-Z0-9]/g, ''));

  const wanted: string[] = [];
  const number = document.invoiceNumber?.trim();
  const series = document.series?.trim();

  if (number) {
    wanted.push(reduce(number));
    if (series) wanted.push(reduce(`${series}${number}`));
  }
  if (document.mark) wanted.push(reduce(document.mark));

  // Two characters is not a reference, it is a coincidence waiting to happen.
  return wanted.some((candidate) => candidate.length >= 3 && tokens.has(candidate));
}

/** Same account, written the way each bank felt like writing it. */
export function ibanMatches(counterparty: string | null, known: readonly string[]): boolean {
  if (!counterparty) return false;
  const normalised = counterparty.replace(/\s+/g, '').toUpperCase();
  if (!normalised) return false;

  return known.some((iban) => iban.replace(/\s+/g, '').toUpperCase() === normalised);
}
