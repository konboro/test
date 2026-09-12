import { describe, expect, it } from 'vitest';

import {
  EDITABLE_SLOTS,
  defaultTemplateFor,
  renderEmail,
  renderSms,
  type TemplateContext,
  type TemplateOverrides,
} from './templates';

const ctx: TemplateContext = {
  debtorName: 'Παπαδόπουλος ΑΕ',
  creditorName: 'Alpha AE',
  invoiceLabel: 'A 1042',
  amountCents: 124000,
  currency: 'EUR',
  dueDate: '2026-07-31',
  payUrl: 'https://lefta.app/pay/abc123',
};

/**
 * Every message says how to pay.
 *
 * A reminder without the link asks for money and gives no way to send it. The
 * editor refuses to save a body that drops the placeholder, but a template
 * stored before that rule existed, or written straight into the database, still
 * can — so the renderer is the layer that cannot be talked out of it.
 */
describe('the payment link', () => {
  it('is in the built-in copy of every slot, in both languages', () => {
    for (const slot of EDITABLE_SLOTS) {
      for (const locale of ['el', 'en'] as const) {
        expect(defaultTemplateFor(slot.key, locale).body).toContain('{{pay_url}}');
      }
    }
  });

  it('is put back into an email whose template dropped it', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:email': { subject: 'Πληρωμή', body: 'Το {{invoice}} είναι ληξιπρόθεσμο.' },
    };

    const mail = renderEmail('overdue_2', ctx, overrides);
    expect(mail.text).toContain(ctx.payUrl);
  });

  it('is put back into an SMS whose template dropped it', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:sms': { subject: null, body: 'Το {{invoice}} είναι ληξιπρόθεσμο.' },
    };

    expect(renderSms('overdue_2', ctx, overrides)).toContain(ctx.payUrl);
  });

  it('is not repeated when the template already has it', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:sms': { subject: null, body: 'Πληρωμή: {{pay_url}}' },
    };

    const sms = renderSms('overdue_2', ctx, overrides);
    expect(sms.split(ctx.payUrl)).toHaveLength(2);
  });

  it('survives in the HTML however the body is written', () => {
    // The button belongs to the frame rather than the body, which is why the
    // HTML half was never at risk — asserted so that stays true.
    const overrides: TemplateOverrides = {
      'overdue_2:email': { subject: 'Πληρωμή', body: 'Χωρίς σύνδεσμο.' },
    };

    expect(renderEmail('overdue_2', ctx, overrides).html).toContain(ctx.payUrl);
  });

  it('leaves the text alone when there is no link to add', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:sms': { subject: null, body: 'Το {{invoice}} είναι ληξιπρόθεσμο.' },
    };

    const sms = renderSms('overdue_2', { ...ctx, payUrl: '' }, overrides);
    expect(sms).toBe('Το A 1042 είναι ληξιπρόθεσμο.');
  });
});
