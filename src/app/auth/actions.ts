'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { safeNextPath } from '@/lib/redirects';
import { createClient } from '@/lib/supabase/server';
import { appUrl } from '@/lib/env';
import { formError, getDictionary } from '@/lib/i18n';

export interface AuthState {
  error?: string;
  notice?: string;
}

const credentials = z.object({
  email: z.string().email('emailRequired'),
  password: z.string().min(8, 'passwordMin'),
});

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getDictionary();

  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: formError(t, parsed.error.issues[0]?.message) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: t.forms.errors.badCredentials };
  }

  redirect(safeNextPath(formData.get('next')));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getDictionary();

  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: formError(t, parsed.error.issues[0]?.message) };
  }

  const companyName = String(formData.get('company_name') ?? '').trim();
  if (!companyName) return { error: t.forms.errors.companyNameRequired };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      // Consumed by the `handle_new_auth_user` trigger, which provisions the
      // tenant row in public.users.
      data: { company_name: companyName },
      // Said explicitly rather than left to the project's Site URL. The link
      // in the confirmation email is the first thing a new tenant clicks, and
      // a Site URL still pointing at a preview deployment sends them to a
      // stranger's copy of the app with a valid code in the query string.
      emailRedirectTo: `${appUrl()}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // With email confirmation enabled the user has no session yet.
  if (!data.session) {
    return { notice: t.forms.notices.confirmEmail };
  }

  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
