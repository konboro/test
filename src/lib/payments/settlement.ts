import type { InvoiceRow } from '@/types/database';

/**
 * How a paid invoice actually got paid.
 *
 * Derived, never stored — the settlement fields already say everything, and a
 * separate "method" column would be one more thing every settlement path could
 * forget to write. The reasoning mirrors the payments timeline on the bank
 * page: a provider's own reference is evidence the money moved through us,
 * `status` alone never is.
 *
 *  - a Stripe session/payment-intent id is only ever written by the Stripe
 *    payment-link flow (webhook or confirm-on-return) → **card via Stripe**;
 *  - a Viva transaction id is written only after the transaction was read back
 *    from Viva's API → **card via Viva**;
 *  - an invoice the bank sweep or review queue settled is a **transfer** — the
 *    caller knows this from `bank_transactions.matched_invoice_id`, which is
 *    where that link lives;
 *  - a paid Elorus import with no local timestamp was settled in the **billing
 *    system** — nothing here recorded the moment;
 *  - `paid_at` with none of the above is the tenant's own "mark paid" — a
 *    settlement recorded **off-platform** (bank transfer typed in by hand,
 *    cash).
 */
export type SettlementMethod =
  | 'card_stripe'
  | 'card_viva'
  | 'card_revolut'
  | 'transfer'
  | 'external'
  | 'billing_system';

export function settlementMethod(
  invoice: Pick<
    InvoiceRow,
    | 'status'
    | 'stripe_checkout_session_id'
    | 'stripe_payment_intent_id'
    | 'viva_transaction_id'
    | 'revolut_order_id'
    | 'paid_at'
    | 'source'
  >,
  options: { settledByBank?: boolean } = {},
): SettlementMethod | null {
  if (invoice.status !== 'paid') return null;

  if (invoice.stripe_checkout_session_id || invoice.stripe_payment_intent_id) return 'card_stripe';
  if (invoice.viva_transaction_id) return 'card_viva';
  // Written only after the order was read back from Revolut, never from a
  // redirect parameter — so its presence is evidence the money moved.
  if (invoice.revolut_order_id) return 'card_revolut';
  if (options.settledByBank) return 'transfer';
  if (invoice.source === 'elorus' && !invoice.paid_at) return 'billing_system';
  return 'external';
}
