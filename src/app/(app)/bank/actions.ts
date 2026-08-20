'use server';

import { revalidatePath } from 'next/cache';

import { activeOrganization } from '@/lib/orgs/active';
import { canWrite } from '@/lib/orgs/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Resolving what the matcher would not decide by itself.
 *
 * The sync settles only what it can corroborate; anything ambiguous is parked in
 * `review` rather than guessed at, because marking the wrong invoice paid stops
 * a reminder that should still be going out. That queue needs a way to be
 * cleared, or the caution just turns into a pile nobody can act on.
 *
 * Both actions run with the service role — the tables are read-only to browser
 * sessions by design — so both re-check ownership first. Without that, a posted
 * id would be enough to settle another creditor's invoice from their own panel.
 */

async function ownedTransaction(transactionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // The credit belongs to a company; the confirmation belongs to a person.
  // Both are needed here, and they stopped being the same value.
  const org = await activeOrganization();
  if (!org || !canWrite(org.role)) return null;

  const { data } = await createAdminClient()
    .from('bank_transactions')
    .select('id, user_id, amount_cents, matched_invoice_id, rejected_invoice_ids')
    .eq('id', transactionId)
    .maybeSingle();

  if (!data || data.user_id !== org.id) return null;
  return { user, org, transaction: data };
}

/** Accepts the proposal: the invoice is settled and the credit is what did it. */
export async function confirmMatch(formData: FormData): Promise<void> {
  const transactionId = String(formData.get('transaction_id') ?? '');
  const invoiceId = String(formData.get('invoice_id') ?? '');
  if (!transactionId || !invoiceId) return;

  const owned = await ownedTransaction(transactionId);
  if (!owned) return;

  const admin = createAdminClient();

  // The invoice has to belong to the same tenant, and still be open. Anything
  // else and this is either a stale page or an id that was never theirs.
  const { data: settled } = await admin
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_amount_cents: owned.transaction.amount_cents,
    })
    .eq('id', invoiceId)
    .eq('user_id', owned.org.id)
    .eq('status', 'pending')
    .select('id');

  if (!settled?.length) return;

  await admin
    .from('bank_transactions')
    .update({
      state: 'settled',
      matched_invoice_id: invoiceId,
      matched_at: new Date().toISOString(),
      matched_by: owned.user.id,
    })
    .eq('id', transactionId);

  revalidatePath('/bank');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');
}

/**
 * Rejects the proposal.
 *
 * The invoice id is remembered in `rejected_invoice_ids` so tomorrow's sweep
 * does not propose the same pair again — an operator who has already said no
 * should not have to keep saying it.
 */
export async function dismissMatch(formData: FormData): Promise<void> {
  const transactionId = String(formData.get('transaction_id') ?? '');
  const invoiceId = String(formData.get('invoice_id') ?? '');
  if (!transactionId) return;

  const owned = await ownedTransaction(transactionId);
  if (!owned) return;

  const rejected = new Set(owned.transaction.rejected_invoice_ids ?? []);
  if (invoiceId) rejected.add(invoiceId);

  await createAdminClient()
    .from('bank_transactions')
    .update({
      state: 'dismissed',
      matched_invoice_id: null,
      rejected_invoice_ids: [...rejected],
    })
    .eq('id', transactionId);

  revalidatePath('/bank');
}

/** Puts a dismissed credit back in play, for when the rejection was the mistake. */
export async function reopenTransaction(formData: FormData): Promise<void> {
  const transactionId = String(formData.get('transaction_id') ?? '');
  if (!transactionId) return;

  const owned = await ownedTransaction(transactionId);
  if (!owned) return;

  await createAdminClient()
    .from('bank_transactions')
    .update({ state: 'unmatched' })
    .eq('id', transactionId);

  revalidatePath('/bank');
}
