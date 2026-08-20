import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { requireEnv } from '@/lib/env';
import { ORG_COOKIE, ORG_HEADER, isOrgId } from '@/lib/orgs/cookie';
import type { Database } from '@/types/database';

/**
 * Supabase client bound to the caller's session cookies.
 *
 * Uses the anon key, so every query is still subject to RLS — this is the right
 * client for anything that runs on behalf of a signed-in tenant.
 *
 * It also carries which company the session is acting for. That header is the
 * single integration point for multi-company: every policy resolves it against
 * the caller's memberships, so each of the queries written before any of this
 * existed is scoped correctly without being touched. A header naming a company
 * the caller does not belong to selects nothing — the policy falls back to
 * their own first company. See docs/multi-company.md.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const activeOrg = cookieStore.get(ORG_COOKIE)?.value;

  return createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      global: isOrgId(activeOrg) ? { headers: { [ORG_HEADER]: activeOrg } } : undefined,
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
