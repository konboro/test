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
    .select('id, user_id, amount_cents, currency, state, matched_invoice_id, rejected_invoice_ids')
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

  // What the credit is being applied to. The ambiguous review lists one Confirm
  // button per candidate, so the invoice is read and checked rather than
  // trusted: a stale tab is the ordinary way somebody arrives here twice.
  const { data: invoice } = await admin
    .from('invoices')
    .select('id, amount_cents, currency')
    .eq('id', invoiceId)
    .eq('user_id', owned.org.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (!invoice) return;

  // Neither of these was checked on this path, though the automatic matcher
  // checks both. A 500,00 PLN invoice could be closed by a €500.00 credit worth
  // a quarter of it, and a €50 credit could close a €10,000 debt.
  if (invoice.currency !== owned.transaction.currency) return;
  if (owned.transaction.amount_cents < invoice.amount_cents) return;

  // Claim the credit before spending it.
  //
  // The credit is the scarce thing — one transfer, one invoice — so it is what
  // has to be claimed atomically. Confirming the same €480 against two €480
  // invoices used to close both, because nothing checked the transaction was
  // still unapplied: €960 of debt settled by €480 of money, with
  // `matched_invoice_id` quietly overwritten to whichever was clicked last.
  const { data: claimed } = await admin
    .from('bank_transactions')
    .update({
      state: 'settled',
      matched_invoice_id: invoiceId,
      matched_at: new Date().toISOString(),
      matched_by: owned.user.id,
    })
    .eq('id', transactionId)
    .neq('state', 'settled')
    .select('id');

  if (!claimed?.length) return;

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

  // The invoice was settled by something else between the two statements. Give
  // the credit back rather than consuming it against nothing — it is still
  // unexplained money and belongs in the review queue.
  if (!settled?.length) {
    await admin
      .from('bank_transactions')
      .update({
        state: owned.transaction.state,
        matched_invoice_id: owned.transaction.matched_invoice_id,
        matched_at: null,
        matched_by: null,
      })
      .eq('id', transactionId);
    return;
  }

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
