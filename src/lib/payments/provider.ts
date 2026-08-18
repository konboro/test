/**
 * Which provider takes the money for a given creditor.
 *
 * One place decides, because the answer has to be identical in three: the route
 * that starts a payment, the route the debtor returns through, and the settings
 * screen that tells the operator what is switched on. Three copies of this rule
 * would drift, and the drift would surface as a payment that starts on one
 * provider and is confirmed against another.
 *
 * Nothing here reaches a browser. The debtor learns which provider is in play
 * when the redirect lands them on it, and `get_invoice_for_payment` still
 * answers only the yes/no question.
 */

import { decryptSecret } from '@/lib/crypto';
import type { VivaCredentials, VivaEnvironment } from '@/lib/viva/client';

export type PaymentProvider = 'stripe' | 'viva';

/** Exactly the columns this decision needs, so callers select no more than that. */
export interface TenantPaymentRow {
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_secret_key_enc?: string | null;
  viva_client_id_enc?: string | null;
  viva_client_secret_enc?: string | null;
  viva_source_code?: string | null;
  viva_environment?: string | null;
  payment_provider?: string | null;
}

// One unbroken literal: postgrest-js parses this string at the type level to
// infer the row shape, and a concatenation defeats that — every caller would
// receive `GenericStringError` instead of a typed row.
export const PAYMENT_COLUMNS =
  'stripe_account_id, stripe_charges_enabled, stripe_secret_key_enc, viva_client_id_enc, viva_client_secret_enc, viva_source_code, viva_environment, payment_provider' as const;

export function stripeConfigured(tenant: TenantPaymentRow): boolean {
  return Boolean(
    (tenant.stripe_account_id && tenant.stripe_charges_enabled) || tenant.stripe_secret_key_enc,
  );
}

export function vivaConfigured(tenant: TenantPaymentRow): boolean {
  return Boolean(tenant.viva_client_id_enc && tenant.viva_client_secret_enc);
}

/**
 * The provider a payment link should use, or null when the creditor cannot take
 * a card at all.
 *
 * A stated preference only wins while that provider is actually configured.
 * Honouring a preference for a provider whose credentials have since been
 * removed would hide a working one behind a dead choice — the button would
 * refuse for a reason nobody can see from the settings screen.
 *
 * With no preference, Stripe goes first: it is what existing tenants are already
 * collecting through, and adding Viva must not silently move them.
 */
export function providerFor(tenant: TenantPaymentRow): PaymentProvider | null {
  const stripe = stripeConfigured(tenant);
  const viva = vivaConfigured(tenant);

  const preferred = tenant.payment_provider;
  if (preferred === 'viva' && viva) return 'viva';
  if (preferred === 'stripe' && stripe) return 'stripe';

  if (stripe) return 'stripe';
  if (viva) return 'viva';
  return null;
}

function environmentOf(value: string | null | undefined): VivaEnvironment {
  return value === 'production' ? 'production' : 'demo';
}

/**
 * Decrypts the tenant's Viva credentials.
 *
 * Returns null rather than throwing when they are absent, so callers can treat
 * "not set up" and "set up" through the same branch they already have for
 * Stripe. A decryption failure is different and is allowed to throw: it means
 * the stored ciphertext no longer matches the key, and silently behaving as
 * though the tenant never configured Viva would send the debtor to a page that
 * says the creditor takes no card payments, which is false.
 */
export function vivaCredentialsFor(tenant: TenantPaymentRow): VivaCredentials | null {
  if (!vivaConfigured(tenant)) return null;

  return {
    clientId: decryptSecret(tenant.viva_client_id_enc as string),
    clientSecret: decryptSecret(tenant.viva_client_secret_enc as string),
    environment: environmentOf(tenant.viva_environment),
    sourceCode: tenant.viva_source_code ?? null,
  };
}
