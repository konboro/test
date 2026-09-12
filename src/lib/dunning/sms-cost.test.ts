import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/dictionaries';
import { segmentCount, usesUnicode } from '@/lib/sms/send';

import { renderSms } from './templates';
import type { TemplateStep } from '@/types/database';

/**
 * What each default reminder costs to send.
 *
 * A template is copy, so it gets edited by whoever is improving the wording,
 * and a segment boundary is invisible while you do that — one more word on a
 * UCS-2 message doubles its price with nothing on screen to say so. This file
 * is the thing that says so.
 *
 * The numbers below are not aspirations. They are what the templates cost
 * today, written down so that changing one is a decision rather than an
 * accident. If a change here is deliberate, update the number and say why in
 * the commit.
 */

/**
 * The manual reminder is `null` rather than a named step — that is what
 * `TemplateStep` is — so each entry carries its own label to report under.
 */
const STEPS: ReadonlyArray<{ label: string; step: TemplateStep }> = [
  { label: 'on_issue', step: 'on_issue' },
  { label: 'pre_due', step: 'pre_due' },
  { label: 'overdue_2', step: 'overdue_2' },
  { label: 'overdue_10', step: 'overdue_10' },
  { label: 'manual', step: null },
];

/**
 * A realistic worst case rather than a short one: a long debtor name, a
 * four-digit invoice number and the full pay URL. A template that fits with
 * "Α 1" and not with a real invoice is not a template that fits.
 */
const CTX = {
  debtorName: 'Nikos Papadopoulos',
  creditorName: 'Penny IKE',
  invoiceLabel: 'A 1042',
  amountCents: 45500,
  currency: 'EUR',
  dueDate: '2026-09-01',
  payUrl: 'https://lefta.app/CDEF234567',
};

/** Segments per default SMS, by locale and step. */
const EXPECTED: Record<string, Record<string, number>> = {
  // Greek is UCS-2, which caps a segment at 70 characters, and every one of
  // these runs to 86-102. Two segments each is the current, deliberate state:
  // shortening them to one is a live proposal, not an oversight.
  el: { on_issue: 2, pre_due: 2, overdue_2: 2, overdue_10: 2, manual: 2 },
  // English fits GSM-7 at 160 septets, euro sign included, so each of these is
  // a single segment. They were billed as two until the encoding check learned
  // the difference; that is the regression this row exists to catch.
  en: { on_issue: 1, pre_due: 1, overdue_2: 1, overdue_10: 1, manual: 1 },
};

describe('what a reminder costs', () => {
  for (const locale of LOCALES) {
    for (const { label, step } of STEPS) {
      it(`${locale} ${label} stays at ${EXPECTED[locale]?.[label]} segment(s)`, () => {
        const message = renderSms(step, CTX, {}, null, locale);
        const expected = EXPECTED[locale]?.[label];

        expect(
          expected,
          `no cost recorded for ${locale}/${label} — add it to EXPECTED`,
        ).toBeDefined();
        expect(segmentCount(message)).toBe(expected);
      });
    }
  }

  it('never lets a template creep over a segment boundary unnoticed', () => {
    // The headroom report. Not an assertion about any one template — an
    // assertion that we know how close each one is, so nobody discovers the
    // boundary by paying for it.
    for (const locale of LOCALES) {
      for (const { label, step } of STEPS) {
        const message = renderSms(step, CTX, {}, null, locale);
        const unicode = usesUnicode(message);
        const perSegment = unicode ? 67 : 153;
        const single = unicode ? 70 : 160;
        const segments = segmentCount(message);
        const capacity = segments === 1 ? single : segments * perSegment;

        // Anything at its ceiling is one character from costing more.
        expect(
          message.length,
          `${locale}/${label} is at the ${segments}-segment ceiling (${message.length}/${capacity})`,
        ).toBeLessThanOrEqual(capacity);
      }
    }
  });

  it('shows that one Greek segment is reachable, so the 2s above are a choice', () => {
    // The rewrite, measured. Everything a debtor needs — who is asking, which
    // document, how much, where to pay — inside a single UCS-2 segment.
    const oneSegment = 'Penny IKE: A 1042, 455,00 € ληξιπρόθεσμο. https://lefta.app/CDEF234567';

    expect(oneSegment).toHaveLength(70);
    expect(segmentCount(oneSegment)).toBe(1);
  });
});
