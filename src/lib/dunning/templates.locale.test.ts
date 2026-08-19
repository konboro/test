import { describe, expect, it } from 'vitest';

import { EDITABLE_SLOTS, renderEmail, renderSms, templateFor, type TemplateContext } from './templates';

const ctx: TemplateContext = {
  debtorName: 'Acme AE',
  creditorName: 'Penny',
  invoiceLabel: 'A 1042',
  amountCents: 12000,
  currency: 'EUR',
  dueDate: '2026-08-12',
  payUrl: 'https://lefta.app/AB12CD',
};

/** Every {{token}} a template asks the renderer to fill in. */
function placeholders(text: string): Set<string> {
  return new Set(text.match(/\{\{[a-z_]+\}\}/g) ?? []);
}

describe('English copy exists for every slot', () => {
  for (const slot of EDITABLE_SLOTS) {
    it(`${slot.key} renders in English`, () => {
      const en = templateFor(slot.step, slot.channel, {}, slot.variant ?? null, 'en');
      expect(en.body.trim()).not.toBe('');
      if (slot.channel === 'email') expect(en.subject?.trim()).not.toBe('');
    });

    it(`${slot.key} is not the Greek copy wearing an English label`, () => {
      const el = templateFor(slot.step, slot.channel, {}, slot.variant ?? null, 'el');
      const en = templateFor(slot.step, slot.channel, {}, slot.variant ?? null, 'en');
      expect(en.body).not.toBe(el.body);
    });

    it(`${slot.key} keeps every placeholder the Greek one uses`, () => {
      // The failure this guards against is silent and expensive: a translation
      // that drops {{pay_url}} still reads like a reminder, still sends, and
      // leaves the customer no way to pay.
      const el = templateFor(slot.step, slot.channel, {}, slot.variant ?? null, 'el');
      const en = templateFor(slot.step, slot.channel, {}, slot.variant ?? null, 'en');

      expect(placeholders(en.body)).toEqual(placeholders(el.body));
      expect(placeholders(en.subject ?? '')).toEqual(placeholders(el.subject ?? ''));
    });
  }
});

describe('rendering in a chosen language', () => {
  it('renders the English body and subject', () => {
    const email = renderEmail('overdue_2', ctx, {}, null, 'en');
    expect(email.text).toContain('is still showing as unpaid');
    expect(email.subject).toContain('Overdue invoice A 1042');
    expect(email.text).toContain('https://lefta.app/AB12CD');
  });

  it('still defaults to Greek when no language is given', () => {
    expect(renderEmail('overdue_2', ctx).subject).toContain('Ληξιπρόθεσμο');
    expect(renderSms('overdue_2', ctx)).toContain('ληξιπρόθεσμο');
  });

  it('substitutes the same values in either language', () => {
    for (const locale of ['el', 'en'] as const) {
      const sms = renderSms('overdue_10', ctx, {}, null, locale);
      expect(sms).toContain('A 1042');
      expect(sms).toContain('120');
      expect(sms).toContain('https://lefta.app/AB12CD');
      expect(sms).not.toContain('{{');
    }
  });

  it('falls back to the plain slot in the same language, not across languages', () => {
    // `penny` is email-only. An SMS asking for it must land on the English
    // manual SMS, not on the Greek one.
    expect(renderSms(null, ctx, {}, 'penny', 'en')).toBe(renderSms(null, ctx, {}, null, 'en'));
    expect(renderSms(null, ctx, {}, 'penny', 'en')).not.toContain('υπενθύμιση');
  });
});
