import { describe, expect, it } from 'vitest';

import {
  applyPlaceholders,
  DEFAULT_TEMPLATES,
  EDITABLE_SLOTS,
  parseSlotKey,
  renderEmail,
  renderSms,
  slotKey,
  templateFor,
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

describe('placeholders', () => {
  it('substitutes every documented token', () => {
    const out = applyPlaceholders(
      '{{debtor_name}}|{{creditor_name}}|{{invoice}}|{{amount}}|{{due_date}}|{{pay_url}}',
      ctx,
    );

    expect(out).toContain('Παπαδόπουλος ΑΕ');
    expect(out).toContain('Alpha AE');
    expect(out).toContain('A 1042');
    expect(out).toContain('https://lefta.app/pay/abc123');
    expect(out).not.toContain('{{');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(applyPlaceholders('{{ invoice }}', ctx)).toBe('A 1042');
  });

  it('leaves an unknown token alone rather than blanking it', () => {
    // A typo must be visible in the preview, not silently eat the sentence.
    expect(applyPlaceholders('Ποσό {{amuont}} τώρα', ctx)).toBe('Ποσό {{amuont}} τώρα');
  });
});

describe('template resolution', () => {
  it('falls back to the built-in copy when a tenant has no override', () => {
    expect(templateFor('overdue_2', 'email', {})).toBe(DEFAULT_TEMPLATES['overdue_2:email']);
  });

  it('prefers the tenant override', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:email': { subject: 'Δικό μας θέμα', body: 'Δικό μας κείμενο {{amount}}' },
    };

    const email = renderEmail('overdue_2', ctx, overrides);
    expect(email.subject).toBe('Δικό μας θέμα');
    expect(email.text).toContain('Δικό μας κείμενο');
    expect(email.text).toContain('1.240,00');
  });

  it('keeps slots independent — overriding one leaves the others default', () => {
    const overrides: TemplateOverrides = {
      'overdue_2:email': { subject: 's', body: 'b' },
    };

    expect(renderEmail('pre_due', ctx, overrides).text).toContain('σας υπενθυμίζουμε');
  });

  it('routes the manual reminder to its own slot', () => {
    expect(slotKey(null, 'email')).toBe('manual:email');

    const overrides: TemplateOverrides = {
      'manual:sms': { subject: null, body: 'Χειροκίνητο: {{invoice}}' },
    };
    expect(renderSms(null, ctx, overrides)).toBe('Χειροκίνητο: A 1042');
  });

  it('every editable slot has a built-in default behind it', () => {
    for (const slot of EDITABLE_SLOTS) {
      expect(DEFAULT_TEMPLATES[slot.key]?.body ?? '').not.toBe('');
      expect(parseSlotKey(slot.key)).toEqual({ step: slot.step, channel: slot.channel });
    }
  });

  it('refuses a slot key that is not offered in the editor', () => {
    expect(parseSlotKey('pre_due:sms')).toBeNull();
    expect(parseSlotKey('nonsense')).toBeNull();
    expect(parseSlotKey('overdue_2:carrier_pigeon')).toBeNull();
  });
});

describe('email rendering', () => {
  it('escapes tenant copy instead of letting it inject markup', () => {
    // A template is copy, not a way to author HTML in a message sent on someone
    // else's behalf.
    const overrides: TemplateOverrides = {
      'manual:email': {
        subject: 'x',
        body: '<script>alert(1)</script> & "quoted"',
      },
    };

    const html = renderEmail(null, ctx, overrides).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes values substituted into the body too', () => {
    const html = renderEmail(
      null,
      { ...ctx, debtorName: '<b>Acme</b>' },
      { 'manual:email': { subject: 'x', body: '{{debtor_name}}' } },
    ).html;

    expect(html).not.toContain('<b>Acme</b>');
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
  });

  it('keeps the payment button and platform footer whatever the copy says', () => {
    const html = renderEmail(null, ctx, {
      'manual:email': { subject: 'x', body: 'μόνο αυτό' },
    }).html;

    expect(html).toContain(ctx.payUrl);
    expect(html).toContain('lefta.app');
  });

  it('turns blank lines into paragraphs and single breaks into <br>', () => {
    const html = renderEmail(null, ctx, {
      'manual:email': { subject: 'x', body: 'πρώτη\nδεύτερη\n\nτρίτη' },
    }).html;

    expect(html).toContain('πρώτη<br />δεύτερη');
    expect((html.match(/<p style="margin:0 0 16px;line-height:1.6;">/g) ?? []).length).toBe(2);
  });
});
