import { describe, expect, it } from 'vitest';

import { correctionsBetween, describeCorrections } from './corrections';

const read = {
  debtorName: 'Penny IKE    Jan Geesmann',
  vatNumber: '802160515',
  invoiceNumber: 'ΑΠΥ-Β-38',
  issueDate: null,
  dueDate: null,
  amountCents: 19963,
  email: null,
  phone: null,
};

const kept = {
  debtorName: 'Jan Geesmann',
  vatNumber: null,
  invoiceNumber: 'ΑΠΥ-Β-38',
  issueDate: '2026-06-30',
  dueDate: '2026-07-15',
  amountCents: 19963,
  email: null,
  phone: null,
};

describe('what the operator changed', () => {
  it('names each field the reader got wrong', () => {
    const corrections = correctionsBetween(read, kept);

    expect(corrections.map((c) => c.field).sort()).toEqual([
      'debtorName',
      'dueDate',
      'issueDate',
      'vatNumber',
    ]);
  });

  it('counts a field left empty and filled in by hand', () => {
    // Finding nothing is the commonest way this reader is wrong, and the one
    // most easily mistaken for the document not carrying the field at all.
    const corrections = correctionsBetween(read, kept);
    const date = corrections.find((c) => c.field === 'issueDate');

    expect(date).toEqual({ field: 'issueDate', read: null, kept: '2026-06-30' });
  });

  it('counts a value the reader invented and a person cleared', () => {
    const corrections = correctionsBetween(read, kept);
    expect(corrections.find((c) => c.field === 'vatNumber')?.kept).toBeNull();
  });

  it('says nothing when the reading was accepted as it stood', () => {
    expect(correctionsBetween(read, read)).toEqual([]);
  });

  it('does not report a difference of type as a correction', () => {
    // The form returns numbers as text. 19963 and "19963" are one value, and
    // reporting them as a correction would bury the real ones.
    expect(correctionsBetween({ amountCents: 19963 }, { amountCents: '19963' })).toEqual([]);
  });

  it('treats an empty string as nothing found', () => {
    expect(correctionsBetween({ phone: '' }, { phone: null })).toEqual([]);
  });

  it('has nothing to say about a reading that was never confirmed', () => {
    expect(correctionsBetween(read, null)).toEqual([]);
    expect(correctionsBetween(null, kept)).toEqual([]);
  });

  it('reads back as one line a person can scan', () => {
    const line = describeCorrections(correctionsBetween(read, kept));

    expect(line).toContain('debtorName: Penny IKE    Jan Geesmann → Jan Geesmann');
    expect(line).toContain('issueDate: — → 2026-06-30');
  });
});
