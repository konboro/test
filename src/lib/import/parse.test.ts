import { describe, expect, it } from 'vitest';

import {
  buildPreview,
  detectDelimiter,
  guessColumns,
  parseAmountCents,
  parseCsv,
  parseDate,
} from './parse';

describe('delimiter', () => {
  it('picks the semicolon Excel writes in decimal-comma locales', () => {
    // Guessing a comma here would split every amount in half.
    expect(detectDelimiter('Nazwa;Kwota;Termin\nPapadopoulos;1.234,56;03/04/2026')).toBe(';');
  });

  it('still handles a plain comma file', () => {
    expect(detectDelimiter('name,amount,due\nAcme,120.00,2026-04-03')).toBe(',');
  });

  it('handles a tab export', () => {
    expect(detectDelimiter('name\tamount\tdue')).toBe('\t');
  });
});

describe('csv grammar', () => {
  it('keeps a delimiter that sits inside quotes', () => {
    const table = parseCsv('name;amount\n"Papadopoulos, Georgios";70,00');
    expect(table.rows[0]).toEqual(['Papadopoulos, Georgios', '70,00']);
  });

  it('unescapes doubled quotes', () => {
    const table = parseCsv('name;amount\n"He said ""yes""";10,00');
    expect(table.rows[0]?.[0]).toBe('He said "yes"');
  });

  it('strips the byte-order mark Excel leaves on the first header', () => {
    // Left in place it becomes part of the header and the mapping never matches.
    const table = parseCsv('﻿name;amount\nAcme;10');
    expect(table.headers[0]).toBe('name');
  });

  it('ignores blank lines rather than importing them as rows', () => {
    const table = parseCsv('name;amount\nAcme;10\n\n\n');
    expect(table.rows).toHaveLength(1);
  });
});

describe('amounts', () => {
  it('reads both European and English groupings', () => {
    expect(parseAmountCents('1.234,56')).toBe(123456);
    expect(parseAmountCents('1,234.56')).toBe(123456);
  });

  it('reads a plain decimal either way round', () => {
    expect(parseAmountCents('70,00')).toBe(7000);
    expect(parseAmountCents('70.00')).toBe(7000);
    expect(parseAmountCents('70')).toBe(7000);
  });

  it('treats exactly three trailing digits as a thousands group', () => {
    // Documented convention, and the preview shows it back before committing.
    expect(parseAmountCents('1,234')).toBe(123400);
    expect(parseAmountCents('1.234')).toBe(123400);
  });

  it('survives currency symbols and the spaces exports hide in numbers', () => {
    expect(parseAmountCents('€ 1 234,56')).toBe(123456);
    expect(parseAmountCents('1 234,56 EUR')).toBe(123456);
  });

  it('keeps a credit note negative instead of flipping it', () => {
    expect(parseAmountCents('-70,00')).toBe(-7000);
  });

  it('refuses anything unreadable rather than importing a zero', () => {
    // A debt silently imported as zero is worse than one that refuses.
    expect(parseAmountCents('')).toBeNull();
    expect(parseAmountCents('brak')).toBeNull();
    expect(parseAmountCents('—')).toBeNull();
  });

  it('truncates excess precision instead of concatenating it', () => {
    // Four or more trailing digits is precision, not a thousands group. Reading
    // it as a group would turn 10.9999 into 109 999 — a hundredfold overstated
    // debt that looks entirely plausible in a list.
    expect(parseAmountCents('10,9999')).toBe(1099);
    expect(parseAmountCents('10.9999')).toBe(1099);
  });
});

describe('dates', () => {
  it('takes ISO as written', () => {
    expect(parseDate('2026-04-03')).toBe('2026-04-03');
  });

  it('reads separated dates day-first', () => {
    // Month-first would move a debt three months without ever looking wrong.
    expect(parseDate('03/04/2026')).toBe('2026-04-03');
    expect(parseDate('03.04.2026')).toBe('2026-04-03');
    expect(parseDate('3-4-2026')).toBe('2026-04-03');
  });

  it('expands a two-digit year', () => {
    expect(parseDate('03/04/26')).toBe('2026-04-03');
  });

  it('rejects a day that does not exist instead of rolling into next month', () => {
    expect(parseDate('31/04/2026')).toBeNull();
    expect(parseDate('32/01/2026')).toBeNull();
  });

  it('returns null for anything it cannot read', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('wkrótce')).toBeNull();
  });
});

describe('column guessing', () => {
  it('recognises Greek headers', () => {
    const mapping = guessColumns(['Επωνυμία', 'ΑΦΜ', 'Ποσό', 'Ημ. Λήξης', 'Email']);
    expect(mapping.name).toBe(0);
    expect(mapping.vat_number).toBe(1);
    expect(mapping.amount).toBe(2);
    expect(mapping.due_date).toBe(3);
    expect(mapping.email).toBe(4);
  });

  it('recognises Polish headers', () => {
    const mapping = guessColumns(['Nazwa', 'NIP', 'Kwota', 'Termin płatności', 'Telefon']);
    expect(mapping.name).toBe(0);
    expect(mapping.vat_number).toBe(1);
    expect(mapping.amount).toBe(2);
    expect(mapping.due_date).toBe(3);
    expect(mapping.phone).toBe(4);
  });

  it('does not map two fields onto the same column', () => {
    const mapping = guessColumns(['Customer', 'Due date', 'Amount']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('preview', () => {
  const today = '2026-08-18';

  it('reports every refused row with a reason', () => {
    // 150 rows importing 148 has to say which two and why, or a bad column
    // mapping is indistinguishable from two broken rows.
    const table = parseCsv(
      [
        'Nazwa;Kwota;Termin',
        'Papadopoulos AE;70,00;01/08/2026',
        ';120,00;01/08/2026',
        'Bez kwoty;;01/08/2026',
        'Ujemna;-50,00;01/08/2026',
      ].join('\n'),
    );

    const preview = buildPreview(table, guessColumns(table.headers), today);

    expect(preview.rows).toHaveLength(1);
    expect(preview.problems.map((p) => p.line)).toEqual([3, 4, 5]);
    expect(preview.problems[2]?.message).toContain('θετικό');
  });

  it('counts what it cannot reach without refusing it', () => {
    // Unreachable is a fact to show, not a reason to drop the debt.
    const table = parseCsv('Nazwa;Kwota\nAcme;70,00');
    const preview = buildPreview(table, guessColumns(table.headers), today);

    expect(preview.rows).toHaveLength(1);
    expect(preview.unreachable).toBe(1);
  });

  it('falls back to today and the tenant term when dates are missing', () => {
    const table = parseCsv('Nazwa;Kwota\nAcme;70,00');
    const preview = buildPreview(table, guessColumns(table.headers), today, 14);

    expect(preview.rows[0]?.issueDate).toBe(today);
    expect(preview.rows[0]?.dueDate).toBe('2026-09-01');
  });

  it('totals what will actually be written', () => {
    const table = parseCsv('Nazwa;Kwota\nA;70,00\nB;1.234,56\nC;zły');
    const preview = buildPreview(table, guessColumns(table.headers), today);

    expect(preview.totalCents).toBe(130456);
    expect(preview.problems).toHaveLength(1);
  });

  it('numbers problems by spreadsheet line, not array index', () => {
    const table = parseCsv('Nazwa;Kwota\nA;70,00\nB;zły');
    const preview = buildPreview(table, guessColumns(table.headers), today);

    // Header is line 1, so the bad row is line 3 — what the operator sees.
    expect(preview.problems[0]?.line).toBe(3);
  });
});
