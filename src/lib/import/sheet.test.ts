import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildPreview, guessColumns, parseCsv } from './parse';
import { readSpreadsheet, tableToTsv } from './sheet';

/** Builds a real workbook in memory, so the test exercises the real reader. */
async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const HEADERS = [
  'Kontrahent',
  'NIP',
  'Nr faktury',
  'Data wystawienia',
  'Termin platnosci',
  'Kwota brutto',
  'E-mail',
];

describe('an export that is not tidy', () => {
  it('finds the header under a title block and a blank line', async () => {
    const bytes = await workbook((wb) => {
      const ws = wb.addWorksheet('Naleznosci');
      ws.addRow(['Zestawienie naleznosci na 2026-08-21']);
      ws.addRow([]);
      ws.addRow(HEADERS);
      ws.addRow([
        'ACME SP. Z O.O.',
        '8971874881',
        'FV/1/2026',
        new Date(Date.UTC(2026, 0, 10)),
        new Date(Date.UTC(2026, 1, 9)),
        1230.5,
        'biuro@acme.pl',
      ]);
    });

    const table = await readSpreadsheet(bytes);

    expect(table?.headerRow).toBe(3);
    expect(table?.headers[0]).toBe('Kontrahent');
    expect(table?.rows).toHaveLength(1);
  });

  it('turns Excel dates back into dates, not serial numbers', async () => {
    // The failure this guards against imports without complaint: a due date
    // column arriving as 45678 is wrong on every row and looks like data.
    const bytes = await workbook((wb) => {
      const ws = wb.addWorksheet('Dane');
      ws.addRow(HEADERS);
      ws.addRow(['X', '1', 'A/1', new Date(Date.UTC(2026, 0, 10)), new Date(Date.UTC(2026, 1, 9)), 10, '']);
    });

    const table = await readSpreadsheet(bytes);

    expect(table?.rows[0]?.[3]).toBe('2026-01-10');
    expect(table?.rows[0]?.[4]).toBe('2026-02-09');
  });

  it('picks the sheet with the data, not the first one', async () => {
    const bytes = await workbook((wb) => {
      const cover = wb.addWorksheet('Instrukcja');
      cover.addRow(['Jak korzystac z zestawienia']);
      cover.addRow(['Wypelnij kolumny i wyslij']);

      const data = wb.addWorksheet('Zestawienie');
      data.addRow(HEADERS);
      data.addRow(['ACME', '897', 'FV/2', new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 2, 31)), 99, '']);
    });

    const table = await readSpreadsheet(bytes);

    expect(table?.sheetName).toBe('Zestawienie');
    expect(table?.sheets).toEqual(['Instrukcja', 'Zestawienie']);
  });

  it('reads a formula cell as its result rather than as an object', async () => {
    const bytes = await workbook((wb) => {
      const ws = wb.addWorksheet('Dane');
      ws.addRow(HEADERS);
      const row = ws.addRow(['ACME', '897', 'FV/3', new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 31)), null, '']);
      row.getCell(6).value = { formula: 'A1*2', result: 246.9 } as ExcelJS.CellFormulaValue;
    });

    const table = await readSpreadsheet(bytes);

    expect(table?.rows[0]?.[5]).toBe('246.9');
    expect(table?.rows[0]?.[5]).not.toContain('object');
  });
});

describe('the whole way through to importable rows', () => {
  it('maps the columns and reads the money and the dates', async () => {
    const bytes = await workbook((wb) => {
      const ws = wb.addWorksheet('Naleznosci');
      ws.addRow(['Zestawienie na dzis']);
      ws.addRow([]);
      ws.addRow(HEADERS);
      ws.addRow([
        'ACME SP. Z O.O.',
        '8971874881',
        'FV/1/2026',
        new Date(Date.UTC(2026, 0, 10)),
        new Date(Date.UTC(2026, 1, 9)),
        1230.5,
        'biuro@acme.pl',
      ]);
    });

    const table = await readSpreadsheet(bytes);
    expect(table).not.toBeNull();

    // From here it is the path the CSV importer already takes.
    const parsed = parseCsv(tableToTsv(table!));
    const mapping = guessColumns(parsed.headers);
    const preview = buildPreview(parsed, mapping, '2026-08-21', 14);

    expect(preview.problems).toEqual([]);
    expect(preview.rows).toHaveLength(1);

    const row = preview.rows[0]!;
    expect(row.name).toBe('ACME SP. Z O.O.');
    expect(row.amountCents).toBe(123050);
    expect(row.dueDate).toBe('2026-02-09');
    expect(row.issueDate).toBe('2026-01-10');
    expect(row.email).toBe('biuro@acme.pl');
    expect(row.vatNumber).toBe('8971874881');
  });
});
