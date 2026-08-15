import { decryptSecret } from '@/lib/crypto';
import { addDays, toCents } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, UserRow } from '@/types/database';

import { fetchAllTransmittedDocs } from './client';
import type { MyDataCredentials, MyDataInvoice } from './types';
import { MyDataError } from './types';

export interface SyncResult {
  fetched: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  debtorsCreated: number;
  skipped: number;
  highestMark: string | null;
}

/** MARKs are long numerics; compare them as BigInt, never as JS numbers. */
function markGreater(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return a.localeCompare(b) > 0;
  }
}

export function credentialsFor(user: UserRow): MyDataCredentials {
  if (!user.mydata_user_id || !user.mydata_subscription_key_enc) {
    throw new MyDataError('myDATA credentials are not configured for this account.');
  }

  return {
    userId: user.mydata_user_id,
    subscriptionKey: decryptSecret(user.mydata_subscription_key_enc),
    environment: user.mydata_environment,
  };
}

/**
 * Pulls issued documents from myDATA and reconciles them into `debtors` and
 * `invoices`.
 *
 * Reconciliation rules:
 *  - a document is matched to an existing invoice by (tenant, MARK);
 *  - a cancelled document moves the invoice to `cancelled`;
 *  - an invoice already marked `paid` is never rewritten — settlement is our
 *    own source of truth and myDATA has no payment state to override it with;
 *  - the debtor is keyed on the counterpart VAT number within the tenant.
 */
export async function syncInvoicesForUser(user: UserRow): Promise<SyncResult> {
  const supabase = createAdminClient();
  const credentials = credentialsFor(user);

  // Resume from the highest MARK already stored so each run is incremental.
  const { data: latest } = await supabase
    .from('invoices')
    .select('mark')
    .eq('user_id', user.id)
    .not('mark', 'is', null)
    .order('mark', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sinceMark = latest?.mark ?? '0';
  const documents = await fetchAllTransmittedDocs(credentials, sinceMark);

  const result: SyncResult = {
    fetched: documents.length,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    debtorsCreated: 0,
    skipped: 0,
    highestMark: null,
  };

  // Cache debtor lookups so a batch of invoices for one counterpart costs a
  // single round trip.
  const debtorsByVat = new Map<string, DebtorRow>();

  for (const doc of documents) {
    if (result.highestMark === null || markGreater(doc.mark, result.highestMark)) {
      result.highestMark = doc.mark;
    }

    const gross = toCents(doc.totalGrossValue);
    if (gross <= 0) {
      // Credit notes and zero-value documents are not receivables.
      result.skipped += 1;
      continue;
    }

    const debtor = await resolveDebtor(user, doc, debtorsByVat, result);
    if (!debtor) {
      result.skipped += 1;
      continue;
    }

    const { data: existing } = await supabase
      .from('invoices')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('mark', doc.mark)
      .maybeSingle();

    const cancelled = doc.cancelledByMark !== null;

    if (existing) {
      // Paid invoices are terminal from our side.
      if (existing.status === 'paid') continue;

      if (cancelled && existing.status !== 'cancelled') {
        await supabase.from('invoices').update({ status: 'cancelled' }).eq('id', existing.id);
        result.invoicesUpdated += 1;
      }
      continue;
    }

    const { error } = await supabase.from('invoices').insert({
      user_id: user.id,
      debtor_id: debtor.id,
      mark: doc.mark,
      invoice_number: doc.aa,
      series: doc.series,
      amount_cents: gross,
      currency: doc.currency || 'EUR',
      issue_date: doc.issueDate,
      due_date: addDays(doc.issueDate, user.default_payment_terms_days),
      status: cancelled ? 'cancelled' : 'pending',
      source: 'mydata',
    });

    if (error) {
      // A concurrent sync may have inserted the same MARK; the unique index
      // makes that harmless.
      result.skipped += 1;
      continue;
    }

    result.invoicesCreated += 1;
  }

  await supabase
    .from('users')
    .update({ mydata_last_sync_at: new Date().toISOString() })
    .eq('id', user.id);

  return result;
}

async function resolveDebtor(
  user: UserRow,
  doc: MyDataInvoice,
  cache: Map<string, DebtorRow>,
  result: SyncResult,
): Promise<DebtorRow | null> {
  const supabase = createAdminClient();
  const vat = doc.counterpart.vatNumber;

  // Retail documents have no counterpart VAT and therefore no one to chase.
  if (!vat) return null;

  const cached = cache.get(vat);
  if (cached) return cached;

  const { data: found } = await supabase
    .from('debtors')
    .select('*')
    .eq('user_id', user.id)
    .eq('vat_number', vat)
    .maybeSingle();

  if (found) {
    cache.set(vat, found);
    return found;
  }

  // myDATA frequently omits the counterpart name. Seed a recognisable
  // placeholder the tenant can correct, along with contact details they must
  // fill in before reminders can go out.
  const { data: created, error } = await supabase
    .from('debtors')
    .insert({
      user_id: user.id,
      name: doc.counterpart.name ?? `ΑΦΜ ${vat}`,
      vat_number: vat,
      email: null,
      phone: null,
    })
    .select('*')
    .single();

  if (error || !created) {
    // Lost a race with a parallel insert — read the winner back.
    const { data: raced } = await supabase
      .from('debtors')
      .select('*')
      .eq('user_id', user.id)
      .eq('vat_number', vat)
      .maybeSingle();

    if (raced) {
      cache.set(vat, raced);
      return raced;
    }
    return null;
  }

  result.debtorsCreated += 1;
  cache.set(vat, created);
  return created;
}
