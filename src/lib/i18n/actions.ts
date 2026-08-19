'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';

import { isLocale, LOCALE_COOKIE } from './index';

/**
 * Switches the interface language, for whoever is asking.
 *
 * The settings screen had its own version of this, and it began by requiring a
 * session — reasonable when the only control lived behind the login, and wrong
 * the moment the switch appears on the marketing pages, where most visitors have
 * no account and the action would have returned silently having done nothing.
 *
 * So the cookie is written first and unconditionally: it is what `getLocale`
 * reads, and for an anonymous visitor it is the entire story. Only then, and
 * only if there is a session, is the preference persisted to the account — that
 * is what carries the choice to a different browser, and it is a nicety rather
 * than the mechanism.
 *
 * The whole tree is revalidated because the language is in the layout chrome as
 * well as the page: revalidating the current path alone would leave a header
 * still speaking the previous language above a translated page.
 */
export async function switchLocale(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  if (!isLocale(locale)) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.from('users').update({ locale }).eq('id', user.id);
  }

  revalidatePath('/', 'layout');
}
