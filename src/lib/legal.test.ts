import { describe, expect, it } from 'vitest';

import {
  entityIdentity,
  LEGAL,
  LEGAL_ENTITY,
  LEGAL_ENTITY_MISSING,
  type LegalEntity,
} from './legal';

/**
 * The operator's identity, as the live pages will print it.
 *
 * These documents are the one place in the product where being vague is a
 * legal problem rather than a styling one: a notice that names no controller
 * identifies nobody, and a bracketed placeholder shipped to production was the
 * state this file exists to prevent returning to.
 */

const LOCALES = ['el', 'en'] as const;

describe('the operator', () => {
  it('is named', () => {
    expect(LEGAL_ENTITY.name).toBe('Mobimetry sp. z o.o.');
  });

  it('never prints a placeholder', () => {
    // The shape the old record had — '[ΑΦΜ]', '[ΔΙΕΥΘΥΝΣΗ]' — read as filled in
    // to every automated check while telling a reader nothing. Unknown is null
    // now, and null renders as nothing.
    for (const value of Object.values(LEGAL_ENTITY)) {
      if (value === null) continue;
      expect(value).not.toMatch(/[[\]]/);
      expect(value.trim()).not.toBe('');
    }
  });

  it('says what it is still missing', () => {
    // Not an assertion that everything is filled — it is not — but that the
    // gap is visible. A field that is null and unlisted is the failure: it
    // would be missing from the pages and from anybody's to-do list at once.
    const nulls = (Object.keys(LEGAL_ENTITY) as Array<keyof LegalEntity>).filter(
      (field) => LEGAL_ENTITY[field] === null,
    );

    expect([...LEGAL_ENTITY_MISSING].sort()).toEqual(nulls.sort());
  });
});

/**
 * Both numbers carry their own check digit, so a typo in either is arithmetic
 * rather than opinion — and a wrong NIP on a published notice is the kind of
 * error nobody reads closely enough to catch by eye. Kept in the test rather
 * than in the module: this guards a constant, it is not behaviour the product
 * needs at runtime.
 */
const checkDigit = (digits: string, weights: number[]): number =>
  weights.reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0) % 11;

describe('the registered numbers', () => {
  it('has a NIP that passes its checksum', () => {
    const nip = LEGAL_ENTITY.nip;
    if (nip === null) return;

    expect(nip).toMatch(/^\d{10}$/);
    expect(checkDigit(nip, [6, 5, 7, 2, 3, 4, 5, 6, 7])).toBe(Number(nip[9]));
  });

  it('has a nine-digit REGON that passes its checksum', () => {
    const regon = LEGAL_ENTITY.regon;
    if (regon === null) return;

    // The value first supplied was this one padded to fourteen characters,
    // which fails the fourteen-digit checksum — a legal entity's REGON is the
    // nine-digit one, and that is what gets published.
    expect(regon).toMatch(/^\d{9}$/);
    expect(checkDigit(regon, [8, 9, 2, 3, 4, 5, 6, 7])).toBe(Number(regon[8]));
  });

  it('has a KRS of ten digits, leading zeros kept', () => {
    const krs = LEGAL_ENTITY.krs;
    if (krs === null) return;

    // No checksum to verify, but the leading zeros are part of it: stored as a
    // number somewhere along the way, 0001265140 becomes 1265140.
    expect(krs).toMatch(/^\d{10}$/);
  });
});

describe('the identity line', () => {
  it.each(LOCALES)('names the company in %s', (locale) => {
    expect(entityIdentity(locale)).toContain('Mobimetry sp. z o.o.');
  });

  it.each(LOCALES)('does not double the full stop after an abbreviated form in %s', (locale) => {
    // The company name ends in "o.o." — appending a sentence closer produced
    // "Mobimetry sp. z o.o.." on the live page. Every abbreviated company form
    // has this shape, so it is the rule, not this one name.
    expect(entityIdentity(locale)).not.toMatch(/\.\.$/);
    expect(entityIdentity(locale)).toMatch(/\.$/);
  });

  it.each(LOCALES)('carries no empty fragments in %s', (locale) => {
    const line = entityIdentity(locale);

    // What an unfilled field used to look like once it was interpolated: a
    // stray comma pair, or a label with nothing after it.
    expect(line).not.toMatch(/,\s*,/);
    expect(line).not.toMatch(/:\s*(,|\.|$)/);
    expect(line).not.toContain('null');
    expect(line).not.toContain('undefined');
  });
});

describe('both documents, in both languages', () => {
  it.each(LOCALES)('closes with the identity line in %s', (locale) => {
    const { privacy, terms } = LEGAL[locale];

    for (const doc of [privacy, terms]) {
      const last = doc.sections.at(-1);
      expect(last?.paragraphs).toContain(entityIdentity(locale));
    }
  });

  it.each(LOCALES)('names the controller where the roles are set out, in %s', (locale) => {
    const text = LEGAL[locale].privacy.sections.flatMap((s) => s.paragraphs).join('\n');
    expect(text).toContain(LEGAL_ENTITY.name);
  });

  it.each(LOCALES)('offers a way to exercise a right, in %s', (locale) => {
    // With no contact email on file the sentence has to degrade to something
    // actionable rather than to "write to null".
    const rights = LEGAL[locale].privacy.sections.flatMap((s) => s.paragraphs).join('\n');

    expect(rights).not.toContain('null');
    expect(rights).toMatch(LEGAL_ENTITY.email ?? LEGAL_ENTITY.name);
  });

  it.each(LOCALES)('points at both supervisory authorities in %s', (locale) => {
    // The controller is Polish, so UODO is its authority; the reader keeps the
    // right to complain at home. Saying only one of the two was the state
    // before the company existed.
    const text = LEGAL[locale].privacy.sections.flatMap((s) => s.paragraphs).join('\n');

    expect(text).toContain('UODO');
    expect(text).toMatch(locale === 'el' ? /Αρχή Προστασίας Δεδομένων/ : /Hellenic Data Protection/);
  });

  it.each(LOCALES)('is dated, and dated after the company existed, in %s', (locale) => {
    for (const doc of [LEGAL[locale].privacy, LEGAL[locale].terms]) {
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.updated >= '2026-09-12').toBe(true);
    }
  });
});
