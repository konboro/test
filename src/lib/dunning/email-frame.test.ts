import { describe, expect, it } from 'vitest';

import { renderEmail, type TemplateContext } from './templates';

const ctx: TemplateContext = {
  debtorName: 'Acme Ltd',
  creditorName: 'Alpha AE',
  invoiceLabel: 'A 1042',
  amountCents: 124000,
  currency: 'EUR',
  dueDate: '2026-07-31',
  payUrl: 'https://lefta.app/pay/abc123',
};

/**
 * The frame follows the language of the body.
 *
 * The copy a tenant writes has had an English half since templates were
 * localised. The parts they cannot edit — the facts box, the button, the
 * footer, the document language — did not, so an English tenant sent English
 * text inside a Greek box with a Greek button on it.
 */
describe('the email frame', () => {
  const english = () => renderEmail('overdue_2', ctx, {}, null, 'en').html;
  const greek = () => renderEmail('overdue_2', ctx, {}, null, 'el').html;

  it('speaks English around an English body', () => {
    const html = english();

    expect(html).toContain('Pay now');
    expect(html).toContain('Invoice');
    expect(html).toContain('Due date');
    expect(html).toContain('Amount due');
    expect(html).toContain('If you have already paid');
    expect(html).toContain('via the lefta.app platform.');
  });

  it('leaves no Greek in an English message', () => {
    const html = english();

    for (const greekWord of [
      'Πληρωμή τώρα',
      'Παραστατικό',
      'Ημερομηνία λήξης',
      'Οφειλόμενο ποσό',
      'Αν έχετε ήδη εξοφλήσει',
      'μέσω της πλατφόρμας',
    ]) {
      expect(html).not.toContain(greekWord);
    }
  });

  it('declares the language it is actually written in', () => {
    // Screen readers pronounce the document by this, and mail clients decide
    // whether to offer a translation by it.
    expect(english()).toContain('<html lang="en">');
    expect(greek()).toContain('<html lang="el">');
  });

  it('still speaks Greek around a Greek body', () => {
    const html = greek();

    expect(html).toContain('Πληρωμή τώρα');
    expect(html).toContain('Οφειλόμενο ποσό');
    expect(html).not.toContain('Pay now');
  });

  it('carries the payment link in both', () => {
    expect(english()).toContain(ctx.payUrl);
    expect(greek()).toContain(ctx.payUrl);
  });
});
