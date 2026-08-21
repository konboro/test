import type { ReportBankHint, ReportDetails } from '@/types/database';

/**
 * "They say they paid — did anything arrive?"
 *
 * A paid_claim naming a date and an amount is checked against the bank feed
 * the moment it is filed, because the reviewer's first move is exactly this
 * lookup and the data is already in the house. The result is a hint pinned to
 * the report — never a decision: settling still goes through the same explicit
 * action it always did.
 */

export interface BankCandidate {
  booked_on: string;
  amount_cents: number;
  counterparty_name: string | null;
  /** Only credits still looking for a home can corroborate a claim. */
  state: string;
}

/** How far off a remembered amount may be and still count. People round. */
const AMOUNT_TOLERANCE = 0.02;
/** A transfer sent "on the 3rd" can book days later; earlier it cannot. */
const DAYS_BEFORE_CLAIM = 1;
const MAX_HINTS = 3;

export function bankHintsFor(
  claim: Pick<ReportDetails, 'claimed_paid_on' | 'claimed_amount_cents'>,
  invoiceAmountCents: number,
  candidates: BankCandidate[],
): ReportBankHint[] {
  // The claimed amount when they named one, the invoice amount otherwise —
  // most people pay the number on the document.
  const expected = claim.claimed_amount_cents ?? invoiceAmountCents;

  const floor = () => {
    if (!claim.claimed_paid_on) return null;

    const day = new Date(`${claim.claimed_paid_on}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) return null;

    day.setUTCDate(day.getUTCDate() - DAYS_BEFORE_CLAIM);
    return day.toISOString().slice(0, 10);
  };
  const earliest = floor();

  return candidates
    .filter((tx) => tx.state === 'unmatched' || tx.state === 'review')
    .filter((tx) => Math.abs(tx.amount_cents - expected) <= expected * AMOUNT_TOLERANCE)
    .filter((tx) => earliest === null || tx.booked_on >= earliest)
    .sort(
      // Closest amount first; among equals, the most recent booking.
      (a, b) =>
        Math.abs(a.amount_cents - expected) - Math.abs(b.amount_cents - expected) ||
        b.booked_on.localeCompare(a.booked_on),
    )
    .slice(0, MAX_HINTS)
    .map((tx) => ({
      booked_on: tx.booked_on,
      amount_cents: tx.amount_cents,
      counterparty_name: tx.counterparty_name,
    }));
}
