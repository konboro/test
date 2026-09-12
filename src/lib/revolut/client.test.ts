import { describe, expect, it } from 'vitest';

import { belongsToInvoice, hostFor, isPaid } from './client';

const order = {
  id: 'ord_1',
  checkoutUrl: 'https://checkout.revolut.com/payment-link/ord_1',
  state: 'completed',
  amount: 12400,
  currency: 'EUR',
  reference: 'inv-1',
};

describe('revolut hosts', () => {
  it('keeps the two estates apart', () => {
    expect(hostFor('production')).toBe('https://merchant.revolut.com');
    expect(hostFor('sandbox')).toBe('https://sandbox-merchant.revolut.com');
  });
});

describe('isPaid', () => {
  it('treats only a completed order as money captured', () => {
    expect(isPaid(order)).toBe(true);
    expect(isPaid({ ...order, state: 'pending' })).toBe(false);
    expect(isPaid({ ...order, state: 'cancelled' })).toBe(false);
    expect(isPaid({ ...order, state: 'failed' })).toBe(false);
  });

  it('does not settle on an authorisation — it can still be cancelled', () => {
    expect(isPaid({ ...order, state: 'authorised' })).toBe(false);
  });
});

describe('belongsToInvoice', () => {
  it('binds an order to the invoice we minted it for', () => {
    expect(belongsToInvoice(order, 'inv-1')).toBe(true);
    expect(belongsToInvoice(order, 'inv-2')).toBe(false);
  });

  it('refuses an order that carries no reference at all', () => {
    // Unverifiable is not the same as valid: a paid order from somewhere else
    // must never settle this invoice.
    expect(belongsToInvoice({ ...order, reference: null }, 'inv-1')).toBe(false);
    expect(belongsToInvoice({ ...order, reference: '' }, 'inv-1')).toBe(false);
  });
});
