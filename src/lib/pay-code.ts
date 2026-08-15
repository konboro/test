/**
 * Short public payment codes.
 *
 * The reminder link is the only surface a debtor ever sees, and it travels by
 * SMS, where `/pay/<48 hex chars>` burns a third of the 160-character segment.
 * So invoices carry a second, much shorter credential and the link lives at the
 * root of the domain: `lefta.app/<code>`.
 *
 * The 48-character `pay_token` is not retired — links already sitting in an
 * inbox keep resolving through `/pay/<token>`.
 */

/**
 * Uppercase letters and digits, minus the glyphs that get misread when someone
 * retypes a code off a printed invoice: `0`/`O` and `1`/`I`.
 *
 * Having no lowercase in the alphabet is what makes a root-level route safe: a
 * code can never collide with one of the app's own paths (`/invoices`,
 * `/settings`, …), whatever length we pick.
 */
export const PAY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 10 symbols over a 32-symbol alphabet = 50 bits.
 *
 * The page behind a code shows the debtor's name and what they owe, so the code
 * has to survive bulk guessing rather than a single lucky hit. Against a book of
 * 10 000 invoices at 1 000 requests/s, 10 characters need ~3 years for one hit;
 * 8 characters need ~30 hours and 6 characters under two minutes. Hence 10.
 */
export const PAY_CODE_LENGTH = 10;

const PAY_CODE_RE = new RegExp(`^[${PAY_CODE_ALPHABET}]{${PAY_CODE_LENGTH}}$`);

/** True when `value` has the shape of a short code (not that it exists). */
export function isPayCode(value: string): boolean {
  return PAY_CODE_RE.test(value);
}

/**
 * Which column holds this credential. The two shapes are disjoint — a short code
 * is 10 uppercase symbols, a legacy token is 48 lowercase hex — so the caller
 * can pick the column without probing both.
 */
export function payCredentialColumn(credential: string): 'short_code' | 'pay_token' {
  return isPayCode(credential) ? 'short_code' : 'pay_token';
}

/**
 * Path a debtor uses for this credential. Legacy tokens keep their `/pay/`
 * prefix so an old link stays on the URL it was mailed with.
 */
export function payPath(credential: string): string {
  return isPayCode(credential) ? `/${credential}` : `/pay/${credential}`;
}
