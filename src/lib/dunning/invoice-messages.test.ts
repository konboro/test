import { describe, expect, it } from 'vitest';

import {
  MESSAGE_FIELD,
  MESSAGE_LIMITS,
  overlayInvoiceMessages,
  parseInvoiceMessages,
  type NoticeTexts,
} from './invoice-messages';

const EFFECTIVE: NoticeTexts = {
  emailSubject: 'Νέο παραστατικό {{invoice}}',
  emailBody: 'Σώμα από τις Ρυθμίσεις.\n{{pay_url}}',
  smsBody: 'SMS από τις Ρυθμίσεις: {{pay_url}}',
};

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

/** Exactly what a rendered-but-untouched quick editor submits. */
const untouched: Array<[string, string]> = [
  [MESSAGE_FIELD.subject('on_issue', 'email'), EFFECTIVE.emailSubject],
  [MESSAGE_FIELD.body('on_issue', 'email'), EFFECTIVE.emailBody],
  [MESSAGE_FIELD.body('on_issue', 'sms'), EFFECTIVE.smsBody],
];

describe('parseInvoiceMessages', () => {
  it('a form that never rendered the editor parses to nothing', () => {
    expect(parseInvoiceMessages(form([]), EFFECTIVE)).toEqual([]);
  });

  it('untouched text is not an override', () => {
    // Storing it would freeze this invoice at today's wording; a tenant who
    // rewrites the notice next month would find one invoice still sending the
    // old words.
    expect(parseInvoiceMessages(form(untouched), EFFECTIVE)).toEqual([]);
  });

  it('a changed body is this invoice’s own wording', () => {
    const edited = untouched.map(([key, value]): [string, string] =>
      key === MESSAGE_FIELD.body('on_issue', 'email')
        ? [key, 'Πληρωμή στον λογαριασμό Alpha, παρακαλώ. {{pay_url}}']
        : [key, value],
    );

    const rows = parseInvoiceMessages(form(edited), EFFECTIVE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ step: 'on_issue', channel: 'email' });
    expect(rows[0]?.body).toContain('Alpha');
  });

  it('a changed subject alone is an override too', () => {
    const edited = untouched.map(([key, value]): [string, string] =>
      key === MESSAGE_FIELD.subject('on_issue', 'email') ? [key, 'Δικό μου θέμα'] : [key, value],
    );

    const rows = parseInvoiceMessages(form(edited), EFFECTIVE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('Δικό μου θέμα');
  });

  it('sms overrides separately, and never carries a subject', () => {
    const edited = untouched.map(([key, value]): [string, string] =>
      key === MESSAGE_FIELD.body('on_issue', 'sms') ? [key, 'Δικό μου SMS {{pay_url}}'] : [key, value],
    );

    const rows = parseInvoiceMessages(form(edited), EFFECTIVE);
    expect(rows).toEqual([
      { step: 'on_issue', channel: 'sms', subject: null, body: 'Δικό μου SMS {{pay_url}}' },
    ]);
  });

  it('an emptied textarea means "use the account wording", not "send nothing"', () => {
    // Switching the notice off has a control of its own; an accidentally
    // cleared field must fall back rather than produce an empty email.
    const cleared = untouched.map(([key, value]): [string, string] =>
      key === MESSAGE_FIELD.body('on_issue', 'email') ? [key, '   '] : [key, value],
    );

    expect(parseInvoiceMessages(form(cleared), EFFECTIVE)).toEqual([]);
  });

  it('clips runaway text to what the column accepts', () => {
    const edited = untouched.map(([key, value]): [string, string] =>
      key === MESSAGE_FIELD.body('on_issue', 'email') ? [key, 'x'.repeat(9000)] : [key, value],
    );

    const rows = parseInvoiceMessages(form(edited), EFFECTIVE);
    expect(rows[0]?.body).toHaveLength(MESSAGE_LIMITS.body);
  });

  it('whitespace alone does not manufacture an override', () => {
    const padded = untouched.map(([key, value]): [string, string] => [key, `  ${value}  `]);
    expect(parseInvoiceMessages(form(padded), EFFECTIVE)).toEqual([]);
  });
});

describe('overlayInvoiceMessages', () => {
  it('the invoice’s wording wins over the account override', () => {
    const merged = overlayInvoiceMessages(
      { 'on_issue:email': { subject: 'Λογαριασμού', body: 'Κείμενο λογαριασμού' } },
      [{ step: 'on_issue', channel: 'email', subject: 'Δικό του', body: 'Δικό του κείμενο' }],
    );

    expect(merged['on_issue:email']).toEqual({ subject: 'Δικό του', body: 'Δικό του κείμενο' });
  });

  it('touches nothing else, and nothing at all when there are no rows', () => {
    const account = { 'pre_due:email': { subject: 's', body: 'b' } };

    expect(overlayInvoiceMessages(account, [])).toBe(account);

    const merged = overlayInvoiceMessages(account, [
      { step: 'on_issue', channel: 'sms', subject: null, body: 'x' },
    ]);
    expect(merged['pre_due:email']).toEqual({ subject: 's', body: 'b' });
    expect(merged['on_issue:sms']).toEqual({ subject: null, body: 'x' });
  });
});
