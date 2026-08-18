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

  const { data } = await supabase.from('users').select('locale').eq('id', user.id).maybeSingle();
  return isLocale(data?.locale) ? data.locale : 'el';
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
