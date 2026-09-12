/**
 * The currencies an invoice may be denominated in, in one place.
 *
 * This knowledge was scattered: the scanner had its own list of codes it could
 * recognise, the importer defaulted anything unknown to euros, the manual form
 * did not ask at all and wrote 'EUR' regardless of what the operator was
 * looking at, and three payment providers each made their own assumption. One
 * list means a currency added here is a currency the whole product handles,
 * rather than one that four files have to be taught separately.
 *
 * Greece sells in euros, so EUR is the default and will be the answer almost
 * every time. The rest are here because the neighbours invoice in them and a
 * scanned document arrives in whatever it was written in — the product's job is
 * to record what the document says, not what the account usually deals in.
 */

export const DEFAULT_CURRENCY = 'EUR';

/**
 * Ordered for a picker: the one nearly every invoice uses, then the currencies
 * of the countries this market actually trades with, then the two global ones.
 */
export const SUPPORTED_CURRENCIES = [
  'EUR',
  'PLN',
  'RON',
  'CZK',
  'HUF',
  'BGN',
  'USD',
  'GBP',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return (
    typeof value === 'string' &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value.toUpperCase())
  );
}

/**
 * A currency code from anywhere — a form, a scan, a billing system — as one of
 * ours.
 *
 * Anything unrecognised becomes the default rather than being stored as typed.
 * A three-letter string that no provider accepts is not more truthful than the
 * fallback; it is an invoice that cannot be paid, discovered at the checkout.
 */
export function normaliseCurrency(value: unknown): SupportedCurrency {
  if (!isSupportedCurrency(value)) return DEFAULT_CURRENCY;
  return value.toUpperCase() as SupportedCurrency;
}

/**
 * Money in more than one currency, kept apart.
 *
 * Totals used to be a single `reduce` over `amount_cents`, which is correct
 * while every invoice is in euros and silently wrong the moment one is not:
 * zloty are added to euros and the sum is labelled with a euro sign. There is
 * no exchange rate in this product and there should not be one — inventing a
 * rate to make a tidy single figure is how a dashboard reports money that does
 * not exist. So the figures stay separate and the screen shows them separately.
 */
export function totalsByCurrency(
  rows: ReadonlyArray<{ amount_cents: number; currency: string }>,
): Array<{ currency: string; cents: number; count: number }> {
  const totals = new Map<string, { cents: number; count: number }>();

  for (const row of rows) {
    const key = row.currency?.toUpperCase() || DEFAULT_CURRENCY;
    const entry = totals.get(key) ?? { cents: 0, count: 0 };

    entry.cents += row.amount_cents;
    entry.count += 1;
    totals.set(key, entry);
  }

  // Largest first, so the figure the operator mostly deals in leads. Ties fall
  // back to the code so the order never moves between two identical renders.
  return [...totals.entries()]
    .map(([currency, entry]) => ({ currency, ...entry }))
    .sort((a, b) => b.cents - a.cents || a.currency.localeCompare(b.currency));
}
