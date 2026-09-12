/**
 * What the operator changed about a reading.
 *
 * Every fault fixed in this reader so far was reported by a person noticing it
 * on screen and saying so. The corrections themselves — the exact field, the
 * wrong value, the right one, on a document still sitting in storage — were
 * made and thrown away. This keeps them, so the next fix starts from evidence
 * rather than from a description.
 *
 * Deliberately not a mechanism for the reader to adapt on its own. A parser
 * that rewrites its own rules from user edits is one nobody can predict or
 * test, and this one decides who gets asked for money.
 */

/** Fields worth comparing. The rest are derived or not editable on review. */
const COMPARED = [
  'debtorName',
  'vatNumber',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'amountCents',
  'email',
  'phone',
] as const;

export type CorrectedField = (typeof COMPARED)[number];

export interface Correction {
  field: CorrectedField;
  /** What the reader proposed. Null covers "found nothing". */
  read: string | null;
  /** What the person saved instead. */
  kept: string | null;
}

/** Compared as text, so 1220 and "1220" are one value rather than a correction. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Where the reading and the saved values differ.
 *
 * A field the reader left empty and a person filled in counts: not finding
 * something is the commonest way this reader is wrong, and the one most easily
 * mistaken for the document simply not carrying it.
 */
export function correctionsBetween(
  extracted: Record<string, unknown> | null | undefined,
  confirmed: Record<string, unknown> | null | undefined,
): Correction[] {
  if (!extracted || !confirmed) return [];

  const found: Correction[] = [];

  for (const field of COMPARED) {
    const read = asText(extracted[field]);
    const kept = asText(confirmed[field]);
    if (read !== kept) found.push({ field, read, kept });
  }

  return found;
}

/** One line per correction, for the log a person actually reads. */
export function describeCorrections(corrections: ReadonlyArray<Correction>): string {
  return corrections
    .map((c) => `${c.field}: ${c.read ?? '—'} → ${c.kept ?? '—'}`)
    .join('; ');
}
