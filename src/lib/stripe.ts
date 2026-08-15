import Stripe from 'stripe';

import { requireEnv } from '@/lib/env';

let client: Stripe | null = null;

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

/** SMS credit bundles. Priced inline so no Stripe dashboard setup is required. */
export const SMS_PACKS = [
  { id: 'pack_100', credits: 100, amountCents: 900, label: '100 SMS' },
  { id: 'pack_500', credits: 500, amountCents: 3900, label: '500 SMS' },
  { id: 'pack_2000', credits: 2000, amountCents: 13900, label: '2.000 SMS' },
] as const;

export function findPack(id: string) {
  return SMS_PACKS.find((p) => p.id === id) ?? null;
}
