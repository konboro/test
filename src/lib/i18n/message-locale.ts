import { LOCALES, type Locale } from './dictionaries';

/**
 * Which language a customer is written to in.
 *
 * Three sources, in order: what the operator chose for that customer, what the
 * phone number implies, and the tenant's own language as the last word.
 */

/** The international prefixes that mean Greek. */
const GREEK_PREFIXES = ['+30', '0030'];

export function isMessageLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Digits, plus a leading +. Numbers in the book carry spaces, dashes and brackets. */
function normalisePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * The language a phone number implies.
 *
 * A number with no country code returns the fallback rather than a guess. That
 * is not a detail: the book holds Greek landlines written the local way, such as
 * 2310…, and reading "no +30" as "not Greek" would switch a customer in
 * Thessaloniki to English on the strength of a formatting habit.
 *
 * Every other country code reads as English. It is the honest default for a
 * language we do not have copy for — better a German customer gets English than
 * Greek they cannot read.
 */
export function localeFromPhone(phone: string | null | undefined, fallback: Locale): Locale {
  if (!phone) return fallback;

  const digits = normalisePhone(phone);
  if (!digits) return fallback;

  if (GREEK_PREFIXES.some((prefix) => digits.startsWith(prefix))) return 'el';

  // An international prefix that is not Greek.
  if (digits.startsWith('+') || digits.startsWith('00')) return 'en';

  return fallback;
}

/**
 * The language for one customer, with the operator's choice winning.
 *
 * An unrecognised stored value falls through to the derivation rather than
 * throwing: a locale removed from the product later must not take the reminder
 * with it.
 */
export function resolveDebtorLocale(
  debtor: { locale?: string | null; phone?: string | null },
  tenant: Locale,
): Locale {
  if (isMessageLocale(debtor.locale)) return debtor.locale;
  return localeFromPhone(debtor.phone, tenant);
}

/**
 * The language the tenant works in, and therefore the language their own
 * template overrides are written in.
 *
 * Matters beyond the UI: a tenant who rewrote the overdue email did so in one
 * language, and reusing that text for a customer being written to in another
 * would send Greek copy under an English subject line.
 */
export function tenantLocale(tenant: { locale?: string | null }): Locale {
  return isMessageLocale(tenant.locale) ? tenant.locale : 'el';
}

/**
 * The overrides that may be used for a message in `locale`.
 *
 * Empty when the message is not in the language the tenant authored, so the
 * built-in copy for that language stands rather than a half-translated mixture.
 * We do not machine-translate someone else's wording about someone else's debt.
 */
export function overridesForLocale<T extends object>(
  overrides: T,
  locale: Locale,
  authoredIn: Locale,
): T | Record<string, never> {
  return locale === authoredIn ? overrides : {};
}

/** "Let the customer decide", or a language the operator picked for this send. */
export type LanguageChoice = 'auto' | Locale;

/**
 * Reads a language choice off a form.
 *
 * Anything unrecognised means auto. A stale or tampered value must fall back to
 * the customer's own language rather than to a fixed one — the wrong language is
 * a message the recipient may simply not read.
 */
export function parseLanguageChoice(value: unknown): LanguageChoice {
  return isMessageLocale(value) ? value : 'auto';
}
