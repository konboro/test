import type { Dictionary } from '@/lib/i18n';

/**
 * The words this page uses, resolved to the customer's language on the server.
 *
 * Passed down as a plain object rather than read from a context: these are
 * client components on a public page with no session and no locale cookie, and
 * the language is a property of the customer the link was sent to.
 *
 * Strings only, and that is the whole point of the type. React refuses to
 * serialise a function across the server/client boundary, and the dictionary
 * holds two values that are functions — the footer and the order description,
 * both of which take an argument. Handing the block over whole rendered the
 * page and then failed it with a 500.
 */
type StringsOnly<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };

export type PayCopy = StringsOnly<Dictionary['pay']>;

/**
 * The part of the block a client component may receive.
 *
 * Filtered by shape rather than by a list of key names, so a template added to
 * the dictionary later is dropped here on its own instead of reintroducing the
 * crash — the caller never has to remember this rule.
 */
export function clientCopy(t: Dictionary['pay']): PayCopy {
  const strings: Record<string, string> = {};

  for (const [key, value] of Object.entries(t)) {
    if (typeof value === 'string') strings[key] = value;
  }

  return strings as PayCopy;
}
