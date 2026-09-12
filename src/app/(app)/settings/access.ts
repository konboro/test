import { redirect } from 'next/navigation';

import { requireOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

/**
 * The session and the company every settings tab needs before it reads anything.
 *
 * These settings belong to the company being worked in, not to the person
 * signed in — an accountant editing a client's reply-to address is editing the
 * client's, and the policy is what makes that true.
 */
export async function settingsAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const org = await requireOrganization();
  return { supabase, org, user };
}

/**
 * What to do when the profile row does not come back.
 *
 * A refused query and a missing row are indistinguishable here, and the handler
 * for both is a redirect that looks exactly like being signed out. One column
 * absent from the SELECT grant fails the whole statement — that is how this
 * screen once signed everyone out — so which of the two it was gets logged
 * before anybody goes anywhere.
 */
export function noProfile(where: string, error: { message: string } | null): never {
  if (error) console.error(`[settings:${where}] profile query refused`, error.message);
  redirect('/login');
}
