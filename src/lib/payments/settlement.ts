import type { InvoiceRow } from '@/types/database';

/**
 * How a paid invoice actually got paid.
 *
 * Derived, never stored — the settlement fields already say everything, and a
 * separate "method" column would be one more thing the webhook, the confirm
 * endpoint, the manual action and the Elorus sync could each forget to write:
 *
 *  - a Stripe session/payment-intent id is only ever written by the payment
 *    link flow (webhook or confirm-on-return), so its presence means **card**;
 *  - `paid_at` without a Stripe id is only written by the tenant's own
 *    "mark paid" action, so that is a settlement recorded **off-platform**
 *    (bank transfer, cash);
 *  - an Elorus document can arrive already `paid`, in which case nothing here
 *    wrote a timestamp — the knowledge lives in the **billing system**.
 */
export type SettlementMethod = 'card' | 'external' | 'billing_system';

export function settlementMethod(
  invoice: Pick<
    InvoiceRow,
    'status' | 'stripe_checkout_session_id' | 'stripe_payment_intent_id' | 'paid_at' | 'source'
  >,
): SettlementMethod | null {
  if (invoice.status !== 'paid') return null;

  if (invoice.stripe_checkout_session_id || invoice.stripe_payment_intent_id) return 'card';
  if (invoice.source === 'elorus' && !invoice.paid_at) return 'billing_system';
  return 'external';
}
