import { afterEach, describe, expect, it, vi } from 'vitest';

import { providerFor, stripeConfigured, vivaConfigured } from './provider';
import { belongsToOrder, checkoutUrl, hostsFor, isSettled } from '../viva/client';

const NONE = {
  stripe_account_id: null,
  stripe_charges_enabled: false,
  stripe_secret_key_enc: null,
  viva_client_id_enc: null,
  viva_client_secret_enc: null,
  viva_source_code: null,
  viva_environment: 'demo',
  payment_provider: null,
};

const STRIPE_KEY = { ...NONE, stripe_secret_key_enc: 'enc' };
const STRIPE_CONNECT = { ...NONE, stripe_account_id: 'acct_1', stripe_charges_enabled: true };
const VIVA = { ...NONE, viva_client_id_enc: 'enc', viva_client_secret_enc: 'enc' };
// Spelled out rather than spread: every fixture carries the full column set, so
// `{...STRIPE_KEY, ...VIVA}` would quietly reset the Stripe half back to null
// and this would test viva-only while claiming to test both.
const BOTH = {
  ...NONE,
  stripe_secret_key_enc: 'enc',
  viva_client_id_enc: 'enc',
  viva_client_secret_enc: 'enc',
};

describe('stripeConfigured', () => {
  it('accepts a tenant-owned key', () => {
    expect(stripeConfigured(STRIPE_KEY)).toBe(true);
  });

  it('accepts a connected account only once charges are enabled', () => {
    expect(stripeConfigured(STRIPE_CONNECT)).toBe(true);
    expect(stripeConfigured({ ...STRIPE_CONNECT, stripe_charges_enabled: false })).toBe(false);
  });

  it('is false with nothing set up', () => {
    expect(stripeConfigured(NONE)).toBe(false);
  });
});

describe('vivaConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('needs both halves of the credential', () => {
    expect(vivaConfigured(VIVA)).toBe(true);
    expect(vivaConfigured({ ...VIVA, viva_client_secret_enc: null })).toBe(false);
    expect(vivaConfigured({ ...VIVA, viva_client_id_enc: null })).toBe(false);
  });

  it('refuses the demo estate in production — a test card must not settle a real invoice', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(vivaConfigured(VIVA)).toBe(false);
    expect(providerFor(VIVA)).toBeNull();
    // Production credentials are unaffected by the gate.
    expect(vivaConfigured({ ...VIVA, viva_environment: 'production' })).toBe(true);
  });

  it('lets a production deployment opt in to the demo estate explicitly', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VIVA_ALLOW_DEMO', '1');

    expect(vivaConfigured(VIVA)).toBe(true);
  });
});

describe('providerFor', () => {
  it('is null when the creditor cannot take a card at all', () => {
    expect(providerFor(NONE)).toBeNull();
  });

  it('uses whichever single provider is configured', () => {
    expect(providerFor(STRIPE_KEY)).toBe('stripe');
    expect(providerFor(VIVA)).toBe('viva');
  });

  it('prefers Stripe when both are configured and nothing was chosen', () => {
    // Existing tenants are already collecting through Stripe; adding Viva must
    // not silently move them.
    expect(providerFor(BOTH)).toBe('stripe');
  });

  it('honours a stated preference', () => {
    expect(providerFor({ ...BOTH, payment_provider: 'viva' })).toBe('viva');
    expect(providerFor({ ...BOTH, payment_provider: 'stripe' })).toBe('stripe');
  });

  it('ignores a preference for a provider that is no longer set up', () => {
    // Otherwise removing the Stripe key would hide a perfectly working Viva
    // behind a dead choice, and the button would refuse for an invisible reason.
    expect(providerFor({ ...VIVA, payment_provider: 'stripe' })).toBe('viva');
    expect(providerFor({ ...STRIPE_KEY, payment_provider: 'viva' })).toBe('stripe');
  });

  it('still returns null when the preference is the only thing set', () => {
    expect(providerFor({ ...NONE, payment_provider: 'viva' })).toBeNull();
  });
});

describe('viva hosts', () => {
  it('keeps the two estates apart', () => {
    expect(hostsFor('demo').accounts).toContain('demo-accounts');
    expect(hostsFor('demo').api).toContain('demo-api');
    expect(hostsFor('production').accounts).toBe('https://accounts.vivapayments.com');
    expect(hostsFor('production').api).toBe('https://api.vivapayments.com');
  });

  it('builds a checkout url the debtor can be sent to', () => {
    expect(checkoutUrl('demo', 1234567890)).toBe(
      'https://demo.vivapayments.com/web/checkout?ref=1234567890',
    );
    expect(checkoutUrl('production', '99')).toBe(
      'https://www.vivapayments.com/web/checkout?ref=99',
    );
  });
});

describe('settlement', () => {
  const tx = (over: Partial<Parameters<typeof isSettled>[0]> = {}) => ({
    transactionId: 't-1',
    statusId: 'F',
    amount: 12.34,
    orderCode: '555',
    merchantTrns: null,
    ...over,
  });

  it('treats only F as captured', () => {
    expect(isSettled(tx())).toBe(true);
    for (const statusId of ['A', 'E', 'M', 'X', '']) {
      expect(isSettled(tx({ statusId }))).toBe(false);
    }
  });

  it('binds a transaction to the order we created', () => {
    expect(belongsToOrder(tx(), '555')).toBe(true);
    expect(belongsToOrder(tx(), '556')).toBe(false);
  });

  it('refuses to bind when there is no order code on either side', () => {
    // An invoice with no stored order code has never started a Viva payment, so
    // nothing may settle it — least of all a blank match.
    expect(belongsToOrder(tx({ orderCode: '' }), '')).toBe(false);
    expect(belongsToOrder(tx(), '')).toBe(false);
  });
});
