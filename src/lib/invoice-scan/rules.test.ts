import { describe, expect, it } from 'vitest';

import { fingerprintOf, matchesFingerprint } from './fingerprint';
import { examplesForPrompt, proposalsFrom } from './rules';

const EPSILON = [
  'ΕΙΔΟΣ ΠΑΡΑΣΤΑΤΙΚΟΥ    ΑΡΙΘΜΟΣ    ΣΕΙΡΑ    ΗΜΕΡΟΜΗΝΙΑ    ΩΡΑ    ΣΕΛΙΔΑ',
  'Τιμολόγιο - Δελτίο Αποστολής    42830    ΤΔΑ    25/6/2026    13:39    1 / 1',
  'ΣΤΟΙΧΕΙΑ ΠΕΛΑΤΗ    ΣΤΟΙΧΕΙΑ ΠΑΡΑΛΗΠΤΗ',
  'ΣΥΝΟΛΟ    12,20',
].join('\n');

const ELORUS_EN = [
  'BILL OF RENDERED SERVICES #ΑΠΥ-Β-38',
  'DATE: Jun 30, 2026',
  'FROM    CLIENT',
  'Penny IKE    Jan Geesmann',
  'Total:    199.63€',
].join('\n');

describe('recognising a template', () => {
  it('gives the same signature to two invoices from one template', () => {
    // Same layout, different everything else — which is the case a rule has to
    // survive, since no two invoices share a number or an amount.
    const other = EPSILON.replace('42830', '99999')
      .replace('ΤΔΑ', 'ΤΠΥ')
      .replace('12,20', '480,00');

    expect(fingerprintOf(other).signature).toBe(fingerprintOf(EPSILON).signature);
  });

  it('separates templates that do not look alike', () => {
    expect(fingerprintOf(ELORUS_EN).signature).not.toBe(fingerprintOf(EPSILON).signature);
  });

  it('says in words which documents it covers', () => {
    // The approval screen has to explain what a rule applies to, and a hash
    // explains nothing.
    expect(fingerprintOf(ELORUS_EN).parts).toContain('from');
    expect(fingerprintOf(ELORUS_EN).parts).toContain('client');
    expect(fingerprintOf(ELORUS_EN).parts).toContain('twoColumn');
  });

  it('matches a document against a stored signature', () => {
    const { signature } = fingerprintOf(EPSILON);

    expect(matchesFingerprint(EPSILON, signature)).toBe(true);
    expect(matchesFingerprint(ELORUS_EN, signature)).toBe(false);
  });

  it('has an answer for a document with no structure at all', () => {
    expect(fingerprintOf('hello').signature).toBe('bare');
  });
});

describe('turning a correction into a proposal', () => {
  const corrections = [
    { field: 'invoiceNumber' as const, read: 'ΣΕΙΡΑ ΗΜΕΡΟΜΗΝΙΑ', kept: '42830' },
  ];

  it('carries the field, both values and where the right one sits', () => {
    const [proposal] = proposalsFrom(corrections, EPSILON);

    expect(proposal?.payload.field).toBe('invoiceNumber');
    expect(proposal?.payload.wrong).toBe('ΣΕΙΡΑ ΗΜΕΡΟΜΗΝΙΑ');
    expect(proposal?.payload.right).toBe('42830');
    // The heading above the value is what makes this teach rather than assert.
    expect(proposal?.payload.context.join('\n')).toContain('ΑΡΙΘΜΟΣ');
  });

  it('is tied to the layout it was learned on', () => {
    const [proposal] = proposalsFrom(corrections, EPSILON);
    expect(proposal?.signature).toBe(fingerprintOf(EPSILON).signature);
  });

  it('proposes nothing when the document does not contain the answer', () => {
    // The operator knew something the page does not say — a customer name from
    // memory, a number from another system. Nothing about reading documents can
    // be learned from that, and pretending otherwise teaches a wrong rule.
    const invented = [{ field: 'debtorName' as const, read: null, kept: 'Someone Not On The Page' }];
    expect(proposalsFrom(invented, EPSILON)).toEqual([]);
  });

  it('proposes nothing for a reading that was accepted as it stood', () => {
    expect(proposalsFrom([], EPSILON)).toEqual([]);
  });
});

describe('what the model is shown', () => {
  it('says nothing at all when nothing has been approved', () => {
    // The prompt must be unchanged for a tenant who has approved nothing, or
    // every reading silently depends on an empty list behaving itself.
    expect(examplesForPrompt([])).toBe('');
  });

  it('shows the field, the right answer and where it was found', () => {
    const prompt = examplesForPrompt([
      { field: 'invoiceNumber', wrong: null, right: '42830', context: ['ΑΡΙΘΜΟΣ  ΣΕΙΡΑ'] },
    ]);

    expect(prompt).toContain('invoiceNumber');
    expect(prompt).toContain('42830');
    expect(prompt).toContain('ΑΡΙΘΜΟΣ');
  });

  it('warns the model not to copy the value', () => {
    // The next invoice of this template has a different number. An example that
    // reads as an answer is worse than no example.
    const prompt = examplesForPrompt([
      { field: 'invoiceNumber', wrong: null, right: '42830', context: [] },
    ]);

    expect(prompt).toContain('not as values to copy');
  });
});
