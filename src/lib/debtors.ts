import type { DebtorRow } from '@/types/database';

/**
 * Whether a customer's name is really a placeholder.
 *
 * myDATA usually omits the counterpart's name, so the sync seeds `ΑΦΜ <number>`
 * to have something to show. On screen that reads as a real name and sits right
 * next to the VAT number it was made from, so a list of imported customers looks
 * like every one of them is called after their own tax id — and there is no clue
 * that the field still needs filling in.
 *
 * Detecting it lets the interface say "no name" plainly and put the number in
 * the field that is actually for numbers.
 */
export function hasPlaceholderName(
  debtor: Pick<DebtorRow, 'name' | 'vat_number'>,
): boolean {
  if (!debtor.vat_number) return false;
  const name = debtor.name.trim();
  return name === `ΑΦΜ ${debtor.vat_number}` || name === debtor.vat_number;
}

/** The name to show, or null when there is not really one yet. */
export function displayName(debtor: Pick<DebtorRow, 'name' | 'vat_number'>): string | null {
  if (hasPlaceholderName(debtor)) return null;
  const name = debtor.name.trim();
  return name === '' ? null : name;
}
