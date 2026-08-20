import { guessColumns } from './parse';

/**
 * Spreadsheets into the same table the CSV importer already understands.
 *
 * The whole point is to add one step and change nothing else: a workbook is
 * turned into tab-separated text here, and from there it travels the path that
 * is already written, already tested and already has a screen where the operator
 * confirms the column mapping before anything is written.
 *
 * What makes it worth its own module is that real exports are not tidy. They
 * open with a title row and a blank line, the useful sheet is rarely the first,
 * and dates are stored as numbers — a due date column that arrives as 45678 is
 * the kind of thing that imports without complaint and is wrong everywhere.
 */

export interface SheetTable {
  sheetName: string;
  /** Every sheet in the workbook, so the screen can say which one was chosen. */
  sheets: string[];
  /** 1-based, for the same reason. */
  headerRow: number;
  headers: string[];
  rows: string[][];
  /** True when the sheet was longer than we are willing to read in one go. */
  truncated: boolean;
}

/** Deep enough to clear a title block and a legend; shallow enough to stay cheap. */
const MAX_HEADER_SCAN = 25;

/**
 * A ceiling, and a reported one.
 *
 * A book of debts is hundreds of rows, not hundreds of thousands. Reading is
 * capped so a stray export cannot exhaust the request, and `truncated` says so
 * rather than letting the operator believe they imported everything.
 */
const MAX_ROWS = 20_000;

/** Excel keeps dates as numbers; exceljs hands back Date objects. */
function isoDate(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * One cell as text.
 *
 * Handles the shapes exceljs actually returns: plain values, Date objects,
 * formula cells carrying a `result`, hyperlink cells carrying `text`, and rich
 * text split into runs. A formula cell rendered as "[object Object]" would
 * survive validation and land in the database looking like a name.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoDate(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'object') {
    const shape = value as {
      richText?: Array<{ text?: string }>;
      result?: unknown;
      text?: string;
    };

    if (Array.isArray(shape.richText)) {
      return shape.richText.map((run) => run.text ?? '').join('').trim();
    }
    if (shape.result !== undefined) return cellToText(shape.result);
    if (typeof shape.text === 'string') return shape.text.trim();

    return '';
  }

  return String(value).trim();
}

/**
 * How much a row looks like a header.
 *
 * Scored by how many known column names it contains, using the same vocabulary
 * the mapping step uses — so a row that maps to five fields beats one that maps
 * to none, whatever their position. Cell count only breaks ties, because a wide
 * band of merged title text can otherwise outscore the real header.
 */
function headerScore(cells: string[]): number {
  const filled = cells.filter((cell) => cell.trim() !== '');
  if (filled.length < 2) return 0;

  const mapped = Object.keys(guessColumns(cells)).length;
  return mapped * 100 + filled.length;
}

function pickHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = 0;

  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i += 1) {
    const score = headerScore(rows[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}

/** Trailing empty columns, which every export has and nothing needs. */
function trimRight(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && (cells[end - 1] ?? '').trim() === '') end -= 1;
  return cells.slice(0, end);
}

/**
 * Reads a workbook into a table.
 *
 * The sheet is chosen by the same score as the header row: the one whose best
 * header names the most fields wins. A workbook opening with a cover sheet, a
 * legend or last year's summary is the normal case, not the exception, and
 * taking the first sheet would import the wrong one silently.
 */
export async function readSpreadsheet(
  bytes: Uint8Array,
  wanted?: string,
): Promise<SheetTable | null> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  if (sheets.length === 0) return null;

  let chosen: { table: SheetTable; score: number } | null = null;

  for (const worksheet of workbook.worksheets) {
    if (wanted && worksheet.name !== wanted) continue;

    const grid: string[][] = [];
    let truncated = false;

    worksheet.eachRow({ includeEmpty: true }, (row, index) => {
      if (index > MAX_ROWS) {
        truncated = true;
        return;
      }
      // exceljs numbers cells from 1 and puts a hole at index 0.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      grid.push(trimRight(values.map(cellToText)));
    });

    if (grid.length === 0) continue;

    const headerIndex = pickHeaderRow(grid);
    const headers = grid[headerIndex] ?? [];
    const score = headerScore(headers);

    const rows = grid
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => cell.trim() !== ''));

    const table: SheetTable = {
      sheetName: worksheet.name,
      sheets,
      headerRow: headerIndex + 1,
      headers,
      rows,
      truncated,
    };

    if (!chosen || score > chosen.score || (score === chosen.score && rows.length > chosen.table.rows.length)) {
      chosen = { table, score };
    }
  }

  return chosen?.table ?? null;
}

/**
 * The table as tab-separated text.
 *
 * Tabs rather than commas: a company name with a comma in it is ordinary, a
 * company name with a tab in it is not, so the delimiter the CSV parser detects
 * downstream is never ambiguous. Any tab that does appear is replaced by a space
 * rather than quoted, which keeps the output parseable by the simplest reading.
 */
export function tableToTsv(table: SheetTable): string {
  const clean = (cell: string) => cell.replace(/[\t\r\n]+/g, ' ').trim();

  return [table.headers, ...table.rows]
    .map((row) => row.map(clean).join('\t'))
    .join('\n');
}
