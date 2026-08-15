import { createClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';
import type { Database } from '@/types/database';

let cached: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role client. Bypasses RLS.
 *
 * Only for trusted server contexts that have no user session to act on behalf
 * of: the myDATA sync, the dunning cron, and the Stripe webhook. Never import
 * this from a component or any route that echoes data back to a browser without
 * its own ownership check.
 */
export function createAdminClient() {
  if (cached) return cached;

  cached = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  return cached;
}
