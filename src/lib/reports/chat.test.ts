import { describe, expect, it } from 'vitest';

import { DICTIONARIES } from '@/lib/i18n/dictionaries';

import { closingFor, greetingFor, submitReportTool, systemPromptFor } from './chat';

/**
 * The payment page is the one surface a customer sees, and until now every
 * word on it was Greek — including for a customer the operator had explicitly
 * marked as English, who got an English reminder and followed it to a page
 * they could not read. These guard the two halves of the fix: the copy really
 * is translated, and the model is told which language belongs to whom.
 */

const GREEK = /[Ͱ-Ͽἀ-῿]/;

const invoice = {
  invoice_number: 'ΤΔΑ 1042',
  amount_cents: 45500,
  currency: 'EUR',
  issue_date: '2026-07-01',
  due_date: '2026-07-31',
  debtor_name: 'Acme Ltd',
  creditor_name: 'Penny',
};

describe('greetingFor', () => {
  it('greets an English visitor in English', () => {
    expect(greetingFor('paid_claim', 'en')).not.toMatch(GREEK);
    expect(greetingFor('dispute', 'en')).not.toMatch(GREEK);
  });

  it('greets a Greek visitor in Greek', () => {
    expect(greetingFor('paid_claim', 'el')).toMatch(GREEK);
    expect(greetingFor('dispute', 'el')).toMatch(GREEK);
  });

  it('asks about the payment or about the problem, not both', () => {
    expect(greetingFor('paid_claim', 'en')).not.toBe(greetingFor('dispute', 'en'));
  });
});

describe('closingFor', () => {
  it('confirms in the visitor’s language', () => {
    expect(closingFor('en')).not.toMatch(GREEK);
    expect(closingFor('el')).toMatch(GREEK);
  });
});

describe('systemPromptFor', () => {
  it('names the visitor’s language and the creditor’s separately', () => {
    // The two are usually the same and occasionally are not: a Greek company
    // chasing a German customer writes to them in English and still needs the
    // filed summary in Greek.
    const prompt = systemPromptFor('paid_claim', invoice, { reader: 'en', writer: 'el' });

    expect(prompt).toContain('Γράφεις στα αγγλικά');
    expect(prompt).toContain('summary του εργαλείου γράφεται πάντα στα ελληνικά');
  });

  it('says Greek to both when the customer is Greek', () => {
    const prompt = systemPromptFor('dispute', invoice, { reader: 'el', writer: 'el' });

    expect(prompt).toContain('Γράφεις στα ελληνικά');
    expect(prompt).not.toContain('στα αγγλικά');
  });

  it('carries the invoice the visitor is already looking at, and nothing else', () => {
    const prompt = systemPromptFor('paid_claim', invoice, { reader: 'el', writer: 'el' });

    expect(prompt).toContain('ΤΔΑ 1042');
    expect(prompt).toContain('Acme Ltd');
    expect(prompt).toContain('Penny');
  });
});

describe('submitReportTool', () => {
  it('asks for the summary in the language the creditor reads', () => {
    const summaryOf = (writer: 'el' | 'en') => {
      const schema = submitReportTool('paid_claim', writer).input_schema as {
        properties: { summary: { description: string } };
      };
      return schema.properties.summary.description;
    };

    expect(summaryOf('el')).toContain('ελληνικά');
    expect(summaryOf('en')).toContain('αγγλικά');
  });

  it('only ever accepts the kind it was opened for', () => {
    const schema = submitReportTool('dispute', 'el').input_schema as {
      properties: { kind: { enum: string[] } };
    };

    expect(schema.properties.kind.enum).toEqual(['dispute']);
  });
});

describe('the payment page dictionary', () => {
  /**
   * The failure this catches is not hypothetical: the whole page was written
   * in Greek and shipped that way, and the cheapest way to reintroduce it is
   * to add a key to `el` and paste the Greek into `en` too.
   */
  it('has no Greek left in the English copy', () => {
    const greek = Object.entries(DICTIONARIES.en.pay)
      .filter(([, value]) => typeof value === 'string' && GREEK.test(value))
      .map(([key]) => key);

    expect(greek).toEqual([]);
  });

  it('translates the values built from a template too', () => {
    expect(DICTIONARIES.en.pay.footerAfter('Penny')).not.toMatch(GREEK);
    expect(DICTIONARIES.en.pay.orderDescription('INV-1')).not.toMatch(GREEK);

    // And they still name what they were given.
    expect(DICTIONARIES.en.pay.footerAfter('Penny')).toContain('Penny');
    expect(DICTIONARIES.en.pay.orderDescription('INV-1')).toContain('INV-1');
  });

  it('says something for every key in both languages', () => {
    for (const [key, value] of Object.entries(DICTIONARIES.el.pay)) {
      const counterpart = (DICTIONARIES.en.pay as Record<string, unknown>)[key];

      expect(typeof counterpart, key).toBe(typeof value);
      if (typeof value === 'string') expect(counterpart, key).not.toBe('');
    }
  });
});
