import type { Correction, CorrectedField } from './corrections';
import { fingerprintOf } from './fingerprint';

/**
 * Turning a correction into something a person can approve.
 *
 * The chain is deliberate and one-directional: a correction is evidence, a
 * proposal is a suggestion, and only an approved proposal reaches the reader.
 * Nothing an operator types changes how documents are read until somebody has
 * looked at it and agreed.
 *
 * That is not caution for its own sake. A reader that rewrites its own rules
 * from user edits cannot be predicted, tested or explained, and this one
 * decides who is asked for money. Approval is what keeps every rule in force
 * something a person chose, and withdrawable the same way.
 */

/**
 * What sort of rule this is.
 *
 * One kind today: an example shown to the model when it reads a document of the
 * same shape. Kept as an open string in the database so a second kind — a
 * column hint for the parser, say — needs review code and nothing else.
 */
export type ScanRuleKind = 'example';

export interface ExamplePayload {
  field: CorrectedField;
  /** What the reader proposed. Null means it found nothing. */
  wrong: string | null;
  /** What the person saved instead. */
  right: string | null;
  /** The lines the right answer was actually on, and the line above them. */
  context: string[];
}

export interface RuleProposal {
  signature: string;
  signatureParts: string[];
  kind: ScanRuleKind;
  payload: ExamplePayload;
}

/** Lines a person can check the proposal against, rather than a whole invoice. */
const CONTEXT_LINES = 2;

/**
 * Where in the document the right answer appears, with the line above it.
 *
 * The line above is usually the heading that should have led there, which is
 * what makes the example teach something rather than merely assert a value.
 */
function contextFor(text: string, value: string | null): string[] {
  if (!value) return [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const at = lines.findIndex((line) => line.includes(value));
  if (at < 0) return [];

  return lines.slice(Math.max(0, at - CONTEXT_LINES + 1), at + 1);
}

/**
 * The proposals a set of corrections justifies.
 *
 * A correction with nothing to show for it — the right answer appears nowhere
 * in the text the reader saw — produces no proposal. Those are the ones where
 * the operator knew something the document does not say, and no rule about
 * reading documents can be learned from them.
 */
export function proposalsFrom(
  corrections: ReadonlyArray<Correction>,
  sourceText: string,
): RuleProposal[] {
  const { signature, parts } = fingerprintOf(sourceText);

  return corrections.flatMap((correction) => {
    const context = contextFor(sourceText, correction.kept);
    if (context.length === 0) return [];

    return [
      {
        signature,
        signatureParts: parts,
        kind: 'example' as const,
        payload: {
          field: correction.field,
          wrong: correction.read,
          right: correction.kept,
          context,
        },
      },
    ];
  });
}

/**
 * Approved examples, as something to put in front of the model.
 *
 * Shown rather than described: the model is told what the right answer was on a
 * document of this shape and where it sat, which is the one thing a transcriber
 * can use and cannot infer. It is not told to copy the value — a different
 * invoice of the same template has a different number.
 */
export function examplesForPrompt(rules: ReadonlyArray<ExamplePayload>): string {
  if (rules.length === 0) return '';

  const lines = rules.map((rule) => {
    const where = rule.context.length ? ` (found on: ${rule.context.join(' / ')})` : '';
    return `- ${rule.field}: on this layout the correct value looked like "${rule.right}"${where}`;
  });

  return [
    '',
    'On earlier documents of this exact layout, these fields were corrected by hand.',
    'Use them as a guide to where each field sits — not as values to copy, because',
    'this document is a different invoice.',
    ...lines,
  ].join('\n');
}
