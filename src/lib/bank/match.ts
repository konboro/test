/**
 * Matching an incoming bank credit to an open invoice.
 *
 * Pure by design: no database, no clock, no network. Everything that decides
 * whether a debt is considered settled is in one testable function, because the
 * cost of being wrong is asymmetric and silent. A false positive stops the
 * reminders on an invoice nobody paid — the customer is never chased again and
 * the money is quietly lost, which is the exact failure this product is sold to
 * prevent. A false negative only means someone confirms a match by hand.
 *
 * The policy is deliberately liberal: an exact amount plus **one** corroborating
 * signal settles the invoice. Two conditions are not part of that trade-off and
 * hold regardless:
 *
 *   - if the same amount fits more than one open invoice, no signal can say
 *     which one the money was for, so it goes to review;
 *   - a payment cannot precede the document it pays.
 *
 * Neither tightens the threshold. They rule out cases where the threshold has
 * nothing to decide between.
 */

import { ibanMatches, namesAgree, referenceMatches } from './normalise';

export interface BankCredit {
  /** Positive minor units. Debits never reach here — they are dropped on ingest. */
  amountCents: number;
  currency: string;
  /** ISO date the bank booked it. */
  bookedOn: string;
  remittance: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
}

export interface InvoiceCandidate {
  invoiceId: string;
  amountCents: number;
  currency: string;
  issueDate: string;
  invoiceNumber: string | null;
  series: string | null;
  mark: string | null;
  debtorName: string | null;
  /** IBANs already seen settling this debtor's invoices. */
  debtorIbans: readonly string[];
}

/** Which corroborating evidence fired. Stored with the match, not just used. */
export type MatchSignal = 'reference' | 'name' | 'iban';

export type MatchDecision =
  | { kind: 'settle'; invoiceId: string; signals: MatchSignal[] }
  | { kind: 'review'; reason: 'ambiguous' | 'amount-only'; invoiceIds: string[] }
  | { kind: 'unmatched' };

/** Evidence linking this credit to this specific document. */
export function signalsFor(credit: BankCredit, candidate: InvoiceCandidate): MatchSignal[] {
  const signals: MatchSignal[] = [];

  if (referenceMatches(credit.remittance, candidate)) signals.push('reference');
  if (namesAgree(candidate.debtorName, credit.counterpartyName)) signals.push('name');
  if (ibanMatches(credit.counterpartyIban, candidate.debtorIbans)) signals.push('iban');

  return signals;
}

/**
 * Decide what to do with one credit.
 *
 * `candidates` is every open invoice of the tenant that received the money —
 * filtering happens here rather than in SQL so the rules stay in one place and
 * stay testable.
 */
export function matchCredit(credit: BankCredit, candidates: readonly InvoiceCandidate[]): MatchDecision {
  if (credit.amountCents <= 0) return { kind: 'unmatched' };

  // The amount is the anchor: exact, to the cent, same currency, and not
  // predating the document. Partial payments are out of scope on purpose — once
  // the amount is allowed to differ it stops anchoring anything.
  const plausible = candidates.filter(
    (candidate) =>
      candidate.amountCents === credit.amountCents &&
      candidate.currency === credit.currency &&
      candidate.issueDate <= credit.bookedOn,
  );

  if (!plausible.length) return { kind: 'unmatched' };

  const corroborated = plausible
    .map((candidate) => ({ candidate, signals: signalsFor(credit, candidate) }))
    .filter((entry) => entry.signals.length > 0);

  if (corroborated.length === 1) {
    const [only] = corroborated;
    if (only) return { kind: 'settle', invoiceId: only.candidate.invoiceId, signals: only.signals };
  }

  if (corroborated.length > 1) {
    return {
      kind: 'review',
      reason: 'ambiguous',
      invoiceIds: corroborated.map((entry) => entry.candidate.invoiceId),
    };
  }

  // The amount fits but nothing else does. Plausible enough to show someone,
  // never enough to act on.
  return {
    kind: 'review',
    reason: 'amount-only',
    invoiceIds: plausible.map((candidate) => candidate.invoiceId),
  };
}
