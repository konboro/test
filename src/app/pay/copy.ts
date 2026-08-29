import type { Dictionary } from '@/lib/i18n';

/**
 * The words this page uses, resolved to the customer's language on the server.
 *
 * Passed down as a plain object rather than read from a context: these are
 * client components on a public page with no session and no locale cookie, and
 * the language is a property of the customer the link was sent to.
 */
export type PayCopy = Dictionary['pay'];
