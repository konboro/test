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
import { optionalEnv } from '@/lib/env';
import type { RevolutCredentials, RevolutEnvironment } from '@/lib/revolut/client';
import type { VivaCredentials, VivaEnvironment } from '@/lib/viva/client';

export type PaymentProvider = 'stripe' | 'viva' | 'revolut';

/** Exactly the columns this decision needs, so callers select no more than that. */
export interface TenantPaymentRow {
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_secret_key_enc?: string | null;
  viva_client_id_enc?: string | null;
  viva_client_secret_enc?: string | null;
  viva_source_code?: string | null;
  viva_environment?: string | null;
  revolut_secret_key_enc?: string | null;
  revolut_environment?: string | null;
  payment_provider?: string | null;
}

// One unbroken literal: postgrest-js parses this string at the type level to
// infer the row shape, and a concatenation defeats that — every caller would
// receive `GenericStringError` instead of a typed row.
export const PAYMENT_COLUMNS =
  'stripe_account_id, stripe_charges_enabled, stripe_secret_key_enc, viva_client_id_enc, viva_client_secret_enc, viva_source_code, viva_environment, revolut_secret_key_enc, revolut_environment, payment_provider' as const;

export function stripeConfigured(tenant: TenantPaymentRow): boolean {
  return Boolean(
    (tenant.stripe_account_id && tenant.stripe_charges_enabled) || tenant.stripe_secret_key_enc,
  );
}

/**
 * Whether the demo estate may serve a payment in this deployment.
 *
 * Demo checkout takes Viva's publicly documented test card and no real money —
 * so in production a demo-credentialled tenant would hand every debtor a Pay
 * button that either declines their real card or lets anyone "settle" a real
 * invoice for zero euros. The settings screen already badges the estate; this
 * is the debtor-facing gate. Previews and local runs keep the demo estate so
 * the flow stays testable end to end, and `VIVA_ALLOW_DEMO=1` opts a
 * production deployment in deliberately.
 */
function demoEstateAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || optionalEnv('VIVA_ALLOW_DEMO') === '1';
}

export function vivaConfigured(tenant: TenantPaymentRow): boolean {
  if (!tenant.viva_client_id_enc || !tenant.viva_client_secret_enc) return false;
  if (environmentOf(tenant.viva_environment) === 'demo') return demoEstateAllowed();
  return true;
}

/**
 * Revolut's sandbox is gated for the same reason Viva's demo estate is: it
 * takes test cards and moves no money, so in production it would hand real
 * debtors a button that either declines their card or "settles" a real invoice
 * for nothing. `REVOLUT_ALLOW_SANDBOX=1` opts a production deployment in.
 */
function sandboxEstateAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || optionalEnv('REVOLUT_ALLOW_SANDBOX') === '1';
}

export function revolutConfigured(tenant: TenantPaymentRow): boolean {
  if (!tenant.revolut_secret_key_enc) return false;
  if (revolutEnvironmentOf(tenant.revolut_environment) === 'sandbox') return sandboxEstateAllowed();
  return true;
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
  const revolut = revolutConfigured(tenant);

  const preferred = tenant.payment_provider;
  if (preferred === 'viva' && viva) return 'viva';
  if (preferred === 'revolut' && revolut) return 'revolut';
  if (preferred === 'stripe' && stripe) return 'stripe';

  if (stripe) return 'stripe';
  if (viva) return 'viva';
  if (revolut) return 'revolut';
  return null;
}

function environmentOf(value: string | null | undefined): VivaEnvironment {
  return value === 'production' ? 'production' : 'demo';
}

function revolutEnvironmentOf(value: string | null | undefined): RevolutEnvironment {
  return value === 'production' ? 'production' : 'sandbox';
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

/** The tenant's Revolut key, decrypted. Same contract as the Viva one above. */
export function revolutCredentialsFor(tenant: TenantPaymentRow): RevolutCredentials | null {
  if (!revolutConfigured(tenant)) return null;

  return {
    secretKey: decryptSecret(tenant.revolut_secret_key_enc as string),
    environment: revolutEnvironmentOf(tenant.revolut_environment),
  };
}
