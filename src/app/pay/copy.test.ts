import { describe, expect, it } from 'vitest';

import { DICTIONARIES } from '@/lib/i18n/dictionaries';

import { clientCopy } from './copy';

/**
 * The payment page is a server component that hands its words to two client
 * ones. Handing over the dictionary block whole rendered the page correctly and
 * then returned 500: React will not serialise a function, and two of the values
 * are templates. The build was clean and the type-check was clean — only the
 * live page said so, which is what these are here to replace.
 */
describe('clientCopy', () => {
  const locales = ['el', 'en'] as const;

  it('hands over strings and nothing else', () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(clientCopy(DICTIONARIES[locale].pay))) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
      }
    }
  });

  it('leaves the templates behind', () => {
    const copy = clientCopy(DICTIONARIES.el.pay) as Record<string, unknown>;

    expect(copy.footerAfter).toBeUndefined();
    expect(copy.orderDescription).toBeUndefined();
  });

  it('survives the boundary the page actually crosses', () => {
    for (const locale of locales) {
      const copy = clientCopy(DICTIONARIES[locale].pay);

      // Not a proof of React's serialiser, but it fails on exactly what React
      // rejects here: a value that does not survive being written out.
      expect(JSON.parse(JSON.stringify(copy))).toEqual(copy);
    }
  });

  it('still carries every word the two client components render', () => {
    const copy = clientCopy(DICTIONARIES.en.pay);

    for (const key of [
      'payNow',
      'redirecting',
      'startFailed',
      'alreadyPaid',
      'notPayableNow',
      'providerMissing',
      'paidClaim',
      'dispute',
      'close',
      'reportSent',
      'writeHere',
      'yourMessage',
      'send',
      'howAndWhen',
      'whatIsWrong',
      'paidOn',
      'amount',
      'amountPlaceholder',
      'referenceOptional',
      'contactOptional',
      'submitFailed',
      'submitting',
      'submit',
    ] as const) {
      expect(copy[key], key).toBeTruthy();
    }
  });
});
