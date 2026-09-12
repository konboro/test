'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDictionary } from '@/lib/i18n';
import { ORG_COOKIE } from '@/lib/orgs/cookie';
import { joinFailure } from '@/lib/orgs/join';
import { createClient } from '@/lib/supabase/server';

export interface JoinState {
  error?: string;
}

/**
 * Accept an invitation.
 *
 * The token is checked inside the database, by a function that runs as its
 * owner: until the moment it is accepted, the invitee is not a member and RLS
 * hides the row from them entirely — there is nothing here to check it against.
 */
export async function acceptInvitation(
  _prev: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const t = await getDictionary();
  const token = String(formData.get('token') ?? '');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/join/${encodeURIComponent(token)}`);

  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });

  if (error) return { error: t.join.errors[joinFailure(error.message)] };
  if (!data) return { error: t.join.errors.failed };

  // Land in the company they were invited to, not in whichever one they were
  // last looking at — accepting an invitation is a statement about where you
  // want to be.
  (await cookies()).set(ORG_COOKIE, data, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
