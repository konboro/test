import { describe, expect, it } from 'vitest';

import { leftoverNotes } from './parse';

const HEADERS = ['Kontrahent', 'Kwota', 'Nr zamowienia', 'Handlowiec', 'Uwagi'];
const ROW = ['ACME', '1230,50', 'ZAM/44', 'Nowak', 'czeka na korekte'];

describe('columns nothing claimed', () => {
  it('keeps them, with their headers', () => {
    // Dropping them silently reads as data loss: the operator can see those
    // columns in their own file, and often the unmapped one explains the debt.
    const note = leftoverNotes(HEADERS, ROW, { name: 0, amount: 1 });

    expect(note).toBe('Nr zamowienia: ZAM/44\nHandlowiec: Nowak\nUwagi: czeka na korekte');
  });

  it('says nothing when every column was used', () => {
    expect(leftoverNotes(['A', 'B'], ['1', '2'], { name: 0, amount: 1 })).toBeNull();
  });

  it('skips empty cells and unnamed columns', () => {
    expect(leftoverNotes(['Kontrahent', '', 'Uwagi'], ['ACME', 'x', '  '], { name: 0 })).toBeNull();
  });

  it('stays inside the limit the notes column is validated at', () => {
    const long = leftoverNotes(['Kontrahent', 'Opis'], ['ACME', 'x'.repeat(2000)], { name: 0 });

    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(500);
    expect(long!.endsWith('…')).toBe(true);
  });
});
