import Stripe from 'stripe';

import { decryptSecret } from '@/lib/crypto';
import { optionalEnv, requireEnv } from '@/lib/env';

let client: Stripe | null = null;

/**
 * The platform's own Stripe client.
 *
 * Used directly only for things lefta sells (SMS credit packs) and for the
 * Connect handshake. Invoice payments go through this same client but carry a
 * `stripeAccount` request option, which makes them **direct charges on the
 * creditor's account** — the money settles to them and never touches the
 * platform balance. That is what keeps lefta an IT provider rather than a
 * payment intermediary.
 */
export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
      // Pinned to the version this SDK's types were generated against.
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
  }
  return client;
}

/**
 * Request options that run a call against a connected account.
 *
 * Every charge for an invoice must carry this. Creating a session without it
 * would silently bill onto the platform account — the exact arrangement this
 * design exists to avoid — so it is a named helper rather than an inline object,
 * to make its absence obvious in review.
 */
export function onBehalfOf(accountId: string): Stripe.RequestOptions {
  return { stripeAccount: accountId };
}

/**
 * How a given tenant takes card payments.
 *
 * Two arrangements, and both end with the money on the creditor's own account:
 *
 *  - `connect`  — the platform's client acting on their connected account.
 *                 The proper answer, and what this becomes once lefta itself has
 *                 a Stripe account to be a platform with.
 *  - `own-key`  — the tenant's own secret key, used directly. A bridge for
 *                 before that exists.
 *
 * Connect wins when both are present: it is revocable from either side and does
 * not involve holding somebody else's secret key.
 */
/**
 * `options` is undefined rather than `{}` for the own-key case on purpose.
 * stripe-node inspects the second argument and rejects one it does not
 * recognise as request options — an empty object included — with "Unknown
 * arguments ([object Object])", failing the call outright. Callers must omit
 * the argument entirely rather than pass something empty.
 */
export type TenantPayments =
  | { kind: 'connect'; client: Stripe; options: Stripe.RequestOptions }
  | { kind: 'own-key'; client: Stripe; options: undefined }
  | { kind: 'none' };

export function paymentsFor(tenant: {
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_secret_key_enc: string | null;
}): TenantPayments {
  if (tenant.stripe_account_id && tenant.stripe_charges_enabled && optionalEnv('STRIPE_SECRET_KEY')) {
    return {
      kind: 'connect',
      client: stripe(),
      options: onBehalfOf(tenant.stripe_account_id),
    };
  }

  if (tenant.stripe_secret_key_enc) {
    return {
      kind: 'own-key',
      client: new Stripe(decryptSecret(tenant.stripe_secret_key_enc), {
        apiVersion: '2025-02-24.acacia',
        typescript: true,
      }),
      options: undefined,
    };
  }

  return { kind: 'none' };
}

/** OAuth client id (`ca_…`) from Stripe → Settings → Connect. */
export function connectClientId(): string {
  return requireEnv('STRIPE_CONNECT_CLIENT_ID');
}

export function connectConfigured(): boolean {
  return Boolean(optionalEnv('STRIPE_SECRET_KEY')) && Boolean(optionalEnv('STRIPE_CONNECT_CLIENT_ID'));
}

/** SMS credit bundles. Priced inline so no Stripe dashboard setup is required. */
export const SMS_PACKS = [
  { id: 'pack_100', credits: 100, amountCents: 900, label: '100 SMS' },
  { id: 'pack_500', credits: 500, amountCents: 3900, label: '500 SMS' },
  { id: 'pack_2000', credits: 2000, amountCents: 13900, label: '2.000 SMS' },
] as const;

export function findPack(id: string) {
  return SMS_PACKS.find((p) => p.id === id) ?? null;
}
