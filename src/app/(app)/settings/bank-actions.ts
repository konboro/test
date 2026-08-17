'use server';

import { revalidatePath } from 'next/cache';

import { bankingConfigured } from '@/lib/bank/client';
import { syncBankFeeds, type BankSyncResult } from '@/lib/bank/sync';
import { createClient } from '@/lib/supabase/server';

export interface BankSyncState {
  error?: string;
  result?: BankSyncResult;
}

/**
 * Reads the bank feed now, for this tenant only.
 *
 * The sweep already does this nightly, but nightly is useless while you are
 * setting the connection up: a feed that returns nothing is indistinguishable
 * from one nobody has asked yet, and the answer arrives the next morning.
 *
 * Scoped to the caller's own id, so pressing it can never pull another tenant's
 * statement even though the sync itself runs with the service role.
 */
export async function syncBankNow(): Promise<BankSyncState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  if (!bankingConfigured()) {
    return { error: 'Η υπηρεσία τραπεζικής σύνδεσης δεν είναι ρυθμισμένη.' };
  }

  try {
    const result = await syncBankFeeds({ userId: user.id });
    revalidatePath('/settings');
    revalidatePath('/dashboard');
    return { result };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}
