import Stripe from 'stripe';

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
