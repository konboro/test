import {
  belongsToInvoice,
  isPaid as revolutPaid,
  retrieveOrder,
} from '@/lib/revolut/client';
import { paymentsFor } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

import { notifyPaymentReceived } from './notify';
import { PAYMENT_COLUMNS, revolutCredentialsFor, type TenantPaymentRow } from './provider';

/**
 * Closing invoices that were paid while nobody was watching.
 *
 * Until this existed, a card payment was recorded by exactly one thing: the
 * debtor's browser coming back to `/api/stripe/confirm` after checkout. The
 * webhook could not stand in for it — `STRIPE_WEBHOOK_SECRET` is unset in
 * production, and the guard there requires a Connect account, which a tenant
 * paying through their own key does not have.
 *
 * So a customer who paid and closed the tab, or lost the redirect to a flaky
 * connection, or paid in one tap through a wallet and switched apps, had their
 * money taken and their invoice left open — and then received the next
 * reminder, and the one after that. Charging someone and continuing to chase
 * them is the worst thing this product can do, and it needed no bug to happen:
 * it was the design.
 *
 * This asks the provider instead of waiting to be told. It runs in the nightly
 * cron ahead of the sweep, on the same reasoning already written there for the
 * bank feed: what has been paid must leave the candidate set before anything
 * chases it.
 */

/** What the provider says about a checkout we started. */
export type CheckoutState =
  /** Money captured. `capturedCents` is what the provider actually took. */
  | { kind: 'paid'; capturedCents: number | null; reference: string | null }
  /** Not paid — still open, abandoned, expired or failed. All the same to us. */
  | { kind: 'open' }
  /** Paid, but it does not belong to this invoice. Never settles anything. */
  | { kind: 'mismatch' };

export type Settlement =
  | { action: 'settle'; paidCents: number; reference: string | null }
  | { action: 'skip'; reason: 'open' | 'mismatch' | 'under-capture' };

/**
 * Whether this checkout settles this invoice, and for how much.
 *
 * Split out from the calls around it because it is the part that decides where
 * money lands, and it is the part worth pinning down in tests.
 *
 * An under-capture does not settle. An invoice can legitimately be corrected
 * upwards while a checkout sits open, and closing it in full for whatever the
 * stale session captured forgives the difference silently — the same rule the
 * Stripe webhook applies. It is reported rather than swallowed, because money
 * arrived and somebody has to look at it.
 */
export function settlementFor(
  invoice: { id: string; amount_cents: number },
  state: CheckoutState,
): Settlement {
  if (state.kind === 'open') return { action: 'skip', reason: 'open' };
  if (state.kind === 'mismatch') return { action: 'skip', reason: 'mismatch' };

  // A provider that captured but will not say how much is taken at its word for
  // the invoice amount: the order was created from the database with that
  // figure, and the provider can only charge what it was asked for.
  const captured = state.capturedCents ?? invoice.amount_cents;

  if (captured < invoice.amount_cents) return { action: 'skip', reason: 'under-capture' };

  return { action: 'settle', paidCents: captured, reference: state.reference };
}

export interface ReconcileResult {
  checked: number;
  settled: number;
  /** Which ones closed, so a caller can drop them without asking again. */
  settledIds: string[];
  stillOpen: number;
  /** Captured, but less than the invoice asks for. Needs a person. */
  underCaptured: { invoiceId: string; capturedCents: number; owedCents: number }[];
  /** Paid, but the checkout names a different invoice. Needs a person. */
  mismatched: string[];
  /** Providers this cannot ask. See `unverifiableNote`. */
  unverifiable: number;
  errors: { invoiceId: string; error: string }[];
}

/**
 * Viva orders cannot be reconciled on this API version.
 *
 * Viva is asked about a *transaction*, and the transaction id only ever reaches
 * us on the debtor's return URL — reading an order back by the code we store is
 * a 404, as the client module already records. Guessing at an endpoint on the
 * money path is the one place this codebase refuses to guess, so a Viva order
 * is counted and named here rather than half-checked.
 */
export const unverifiableNote =
  'viva: no order lookup on this API version — settlement still depends on the return URL';

/** How many invoices one run will ask about. Generous for current volumes. */
const BATCH = 200;

export interface ReconcileScope {
  /**
   * Only these invoices.
   *
   * The nightly run takes everything; a bulk press takes only what the operator
   * selected. Sending by hand does not wait for the cron, and the operator here
   * sends by hand a hundred at a time — so the same question gets asked on that
   * path too, for the handful of rows that ever started a checkout.
   */
  invoiceIds?: string[];
}

export async function reconcileCheckouts(scope: ReconcileScope = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checked: 0,
    settled: 0,
    settledIds: [],
    stillOpen: 0,
    underCaptured: [],
    mismatched: [],
    unverifiable: 0,
    errors: [],
  };

  const admin = createAdminClient();

  // Only open invoices that actually started a checkout. Everything else has
  // nothing to ask about.
  let query = admin
    .from('invoices')
    .select('id, user_id, amount_cents, stripe_checkout_session_id, revolut_order_id, viva_order_code')
    .eq('status', 'pending')
    .or(
      'stripe_checkout_session_id.not.is.null,revolut_order_id.not.is.null,viva_order_code.not.is.null',
    );

  // An empty list means "these none", not "all of them" — a caller that filtered
  // everything out must not silently reconcile the whole book.
  if (scope.invoiceIds) {
    if (!scope.invoiceIds.length) return result;
    query = query.in('id', scope.invoiceIds.slice(0, BATCH));
  }

  const { data: invoices, error } = await query
    .order('updated_at', { ascending: false })
    .limit(BATCH);

  if (error) {
    result.errors.push({ invoiceId: '-', error: `Loading invoices: ${error.message}` });
    return result;
  }

  if (!invoices?.length) return result;

  // One read per tenant rather than one per invoice.
  const tenants = new Map<string, TenantPaymentRow | null>();

  for (const invoice of invoices) {
    if (!tenants.has(invoice.user_id)) {
      const { data } = await admin
        .from('users')
        .select(PAYMENT_COLUMNS)
        .eq('id', invoice.user_id)
        .maybeSingle();

      tenants.set(invoice.user_id, data ?? null);
    }

    const tenant = tenants.get(invoice.user_id);
    if (!tenant) continue;

    // Viva first, so it is counted rather than attempted.
    if (!invoice.stripe_checkout_session_id && !invoice.revolut_order_id) {
      if (invoice.viva_order_code) result.unverifiable += 1;
      continue;
    }

    result.checked += 1;

    let state: CheckoutState;

    try {
      state = invoice.stripe_checkout_session_id
        ? await stripeState(tenant, invoice.id, invoice.stripe_checkout_session_id)
        : await revolutState(tenant, invoice.id, invoice.revolut_order_id!);
    } catch (cause) {
      // One provider being unreachable must not stop the rest of the run.
      result.errors.push({
        invoiceId: invoice.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }

    const decision = settlementFor(invoice, state);

    if (decision.action === 'skip') {
      if (decision.reason === 'open') result.stillOpen += 1;
      if (decision.reason === 'mismatch') result.mismatched.push(invoice.id);
      if (decision.reason === 'under-capture' && state.kind === 'paid') {
        result.underCaptured.push({
          invoiceId: invoice.id,
          capturedCents: state.capturedCents ?? 0,
          owedCents: invoice.amount_cents,
        });
      }
      continue;
    }

    // Conditional on the invoice still being open, so a run that overlaps the
    // debtor's own return settles once and notifies once.
    const { data: settled, error: writeError } = await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_amount_cents: decision.paidCents,
        ...(invoice.stripe_checkout_session_id && decision.reference
          ? { stripe_payment_intent_id: decision.reference }
          : {}),
      })
      .eq('id', invoice.id)
      .eq('status', 'pending')
      .select('id');

    if (writeError) {
      result.errors.push({ invoiceId: invoice.id, error: writeError.message });
      continue;
    }

    if (settled?.length) {
      result.settled += 1;
      result.settledIds.push(invoice.id);
      await notifyPaymentReceived(invoice.id);
    }
  }

  return result;
}

async function stripeState(
  tenant: TenantPaymentRow,
  invoiceId: string,
  sessionId: string,
): Promise<CheckoutState> {
  const payments = paymentsFor({
    stripe_account_id: tenant.stripe_account_id ?? null,
    stripe_charges_enabled: tenant.stripe_charges_enabled ?? false,
    stripe_secret_key_enc: tenant.stripe_secret_key_enc ?? null,
  });

  if (payments.kind === 'none') return { kind: 'open' };

  const session = payments.options
    ? await payments.client.checkout.sessions.retrieve(sessionId, payments.options)
    : await payments.client.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== 'paid') return { kind: 'open' };

  // The same binding the return path checks: metadata we wrote ourselves.
  if (session.metadata?.invoice_id !== invoiceId) return { kind: 'mismatch' };

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  return {
    kind: 'paid',
    capturedCents: session.amount_total ?? null,
    reference: paymentIntentId,
  };
}

async function revolutState(
  tenant: TenantPaymentRow,
  invoiceId: string,
  orderId: string,
): Promise<CheckoutState> {
  const credentials = revolutCredentialsFor(tenant);
  if (!credentials) return { kind: 'open' };

  const order = await retrieveOrder(credentials, orderId);

  if (!revolutPaid(order)) return { kind: 'open' };
  if (!belongsToInvoice(order, invoiceId)) return { kind: 'mismatch' };

  return { kind: 'paid', capturedCents: order.amount, reference: order.id };
}
