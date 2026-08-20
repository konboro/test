import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';

import { DICTIONARIES, isLocale, type Dictionary, type Locale } from './dictionaries';

export { LOCALES, isLocale, type Dictionary, type Locale } from './dictionaries';

export const LOCALE_COOKIE = 'lefta_locale';

/**
 * The language to render in.
 *
 * The cookie is the fast path and is written whenever the preference is saved,
 * so an ordinary page render costs no extra query. It is only when the cookie is
 * missing — a fresh browser, or a session that predates the setting — that the
 * stored account preference is read back, and that read also repairs nothing:
 * setting a cookie during render is not allowed in Next, so the value simply
 * applies until the tenant next saves.
 *
 * Greek is the default: the product is sold in Greece, and an untouched account
 * should look exactly as it did before this existed.
 */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 'el';

  // No `id` filter: the policy shows exactly one company — the one this session
  // is acting for — and the signed-in person is no longer that company's id.
  // Filtering by their auth id would return nothing the moment an accountant is
  // working inside a client's books, and the interface would silently fall back
  // to Greek for them.
  const { data } = await supabase.from('users').select('locale').limit(1);
  return isLocale(data?.[0]?.locale) ? data[0].locale : 'el';
}

export async function getDictionary(): Promise<Dictionary> {
  return DICTIONARIES[await getLocale()];
}

/** For code that already knows the locale and just needs the strings. */
export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * A validation message by key.
 *
 * Schemas are built once at module load, long before a request exists, so they
 * cannot hold translated text. They carry keys instead and this resolves them
 * when the failure is actually reported. An unknown key degrades to the generic
 * message rather than showing the key itself to a customer.
 */
export function formError(t: Dictionary, key: string | undefined): string {
  const errors = t.forms.errors as Record<string, unknown>;
  const value = key ? errors[key] : undefined;
  return typeof value === 'string' ? value : t.forms.errors.invalidData;
}
