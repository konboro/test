import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { requireEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Supabase client bound to the caller's session cookies.
 *
 * Uses the anon key, so every query is still subject to RLS — this is the right
 * client for anything that runs on behalf of a signed-in tenant.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
