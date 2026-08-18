/**
 * Reading a book of debts out of a spreadsheet.
 *
 * The file comes from whatever the operator had: an export from their own
 * system, an accountant's spreadsheet, a query someone ran once. So nothing here
 * assumes a format — it detects, reports what it decided, and lets the operator
 * see every parsed row before anything is written.
 *
 * The dangerous part is not the CSV grammar, it is the numbers and dates.
 * "1.234,56" is twelve hundred euros in Greece and Poland and one and a bit in
 * an English export; "03/04/2026" is March in one convention and April in
 * another. Getting either wrong writes a wrong debt and chases someone for it,
 * so both are decided by documented rules and shown back before committing.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

/**
 * Which character separates the columns.
 *
 * Excel writes `;` wherever the locale uses a decimal comma, which is most of
 * Europe — guessing `,` there splits every amount in half. Decided by counting
 * candidates in the header line, because that line has no quoted free text to
 * confuse the count.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [';', '\t', ',', '|'];

  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/**
 * CSV into rows, honouring quotes.
 *
 * Hand-rolled rather than pulled in: the grammar is small, and a dependency that
 * parses everything would still leave the amount and date questions below, which
 * are the ones that actually cause wrong data.
 */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): ParsedTable {
  // A BOM survives Excel exports and would otherwise become part of the first
  // header, so the mapping never matches it.
  const clean = text.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headers = [], ...body] = nonEmpty;

  return {
    headers: headers.map((h) => h.trim()),
    rows: body,
    delimiter,
  };
}

/**
 * An amount, in cents, from however it was written.
 *
 * Both separators present means the last one is the decimal point, which settles
 * "1.234,56" and "1,234.56" without guessing. A lone separator is genuinely
 * ambiguous — "1,234" is twelve hundred and thirty four in most of Europe and
 * one point two three four in an English export — so it is resolved by the digit
 * count: one or two trailing digits is a decimal, exactly three is a thousands
 * group. That is a convention, not a certainty, which is why the preview shows
 * every parsed amount back before anything is written.
 *
 * Returns null rather than zero for anything unreadable. A debt silently
 * imported as zero is worse than one that refuses to import.
 */
export function parseAmountCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Currency symbols, thin spaces and non-breaking spaces all arrive from real
  // exports; the sign is kept because a credit note is negative and must be
  // rejected below rather than silently flipped.
  const cleaned = trimmed.replace(/[^\d,.\-+]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const digitsOnly = cleaned.replace(/[+-]/g, '');

  const lastComma = digitsOnly.lastIndexOf(',');
  const lastDot = digitsOnly.lastIndexOf('.');

  let decimalAt = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const only = Math.max(lastComma, lastDot);
    const trailing = digitsOnly.length - only - 1;
    // Exactly three trailing digits is the one case that reads as a thousands
    // group. Everything else is a decimal point — including four or more, which
    // is excess precision rather than a grouping. Treating those as a group
    // instead would concatenate the digits and inflate the debt a hundredfold.
    if (trailing !== 3) decimalAt = only;
  }

  const whole = (decimalAt >= 0 ? digitsOnly.slice(0, decimalAt) : digitsOnly).replace(/[.,]/g, '');
  const fraction = decimalAt >= 0 ? digitsOnly.slice(decimalAt + 1).replace(/[.,]/g, '') : '';

  if (!whole && !fraction) return null;

  const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2) || '0');
  if (!Number.isFinite(cents)) return null;

  return negative ? -cents : cents;
}

/**
 * A date, as ISO, from the conventions a European export actually uses.
 *
 * `2026-04-03` is unambiguous and taken as written. Anything separated by dots,
 * slashes or dashes is read day-first, because every locale this product serves
 * writes it that way — and month-first would put a debt three months in the
 * wrong direction without ever looking wrong.
 */
export function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(trimmed);
  if (!parts) return null;

  const day = Number(parts[1]);
  const month = Number(parts[2]);
  let year = Number(parts[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;

  return valid(year, month, day);
}

function valid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects the 31st of a 30-day month rather than rolling it into the next one.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date.toISOString().slice(0, 10);
}

/** The fields a debt needs before the ladder can do anything with it. */
export type ImportField =
  | 'name'
  | 'email'
  | 'phone'
  | 'vat_number'
  | 'amount'
  | 'due_date'
  | 'issue_date'
  | 'reference'
  | 'external_ref';

/**
 * Header words that mean each field, across the languages a file arrives in.
 *
 * Matched on a folded form, so "Ημ. Λήξης", "due date" and "Termin płatności"
 * all land on the same field without the operator remapping anything. The
 * mapping is only ever a suggestion — the screen shows it and lets it be
 * changed, because a wrong guess here quietly imports the wrong column.
 */
const HEADER_HINTS: Record<ImportField, string[]> = {
  name: ['name', 'customer', 'client', 'debtor', 'company', 'επωνυμια', 'ονομα', 'πελατης', 'nazwa', 'klient', 'kontrahent'],
  email: ['email', 'e-mail', 'mail', 'ηλεκτρονικο', 'poczta'],
  phone: ['phone', 'mobile', 'tel', 'τηλεφωνο', 'κινητο', 'telefon'],
  vat_number: ['vat', 'afm', 'tax', 'αφμ', 'nip', 'regon'],
  amount: ['amount', 'total', 'balance', 'due', 'debt', 'owed', 'ποσο', 'υπολοιπο', 'οφειλη', 'kwota', 'saldo', 'naleznosc'],
  due_date: ['duedate', 'due', 'deadline', 'ληξη', 'ληξης', 'προθεσμια', 'termin', 'platnosci'],
  issue_date: ['issuedate', 'issued', 'date', 'invoicedate', 'εκδοση', 'εκδοσης', 'ημερομηνια', 'data', 'wystawienia'],
  reference: ['invoice', 'document', 'number', 'ref', 'παραστατικο', 'αριθμος', 'faktura', 'numer', 'dokument'],
  external_ref: ['id', 'externalid', 'chargeid', 'rideid', 'accountid', 'κωδικος', 'identyfikator'],
};

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    // Strips Greek and Latin diacritics so "Ημ. Λήξης" folds to "ημ ληξης".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ωąćęłńóśźż0-9]+/g, '');
}

/** Best guess at which column is which, for the operator to confirm or correct. */
export function guessColumns(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const taken = new Set<number>();

  // Longer hints first, so "due date" wins over "date" and does not leave the
  // due column mapped to issue.
  const fields = Object.keys(HEADER_HINTS) as ImportField[];

  for (const field of fields) {
    const hints = [...HEADER_HINTS[field]].sort((a, b) => b.length - a.length);

    for (const hint of hints) {
      const index = headers.findIndex((header, i) => !taken.has(i) && fold(header).includes(hint));
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
        break;
      }
    }
  }

  return mapping;
}

export interface ImportRow {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  amountCents: number;
  dueDate: string;
  issueDate: string;
  reference: string | null;
  externalRef: string | null;
}

export interface RowProblem {
  line: number;
  message: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  problems: RowProblem[];
  /** Rows carrying neither an email nor a phone: importable, but unreachable. */
  unreachable: number;
  totalCents: number;
}

/**
 * Turns mapped columns into debts, keeping every reason a row was refused.
 *
 * Nothing is dropped quietly. A file of 150 rows that imports 138 has to say
 * which twelve and why, or the operator has no way to tell a bad column mapping
 * from twelve genuinely broken rows.
 */
export function buildPreview(
  table: ParsedTable,
  mapping: Partial<Record<ImportField, number>>,
  today: string,
  defaultTermDays = 0,
): ImportPreview {
  const rows: ImportRow[] = [];
  const problems: RowProblem[] = [];
  let unreachable = 0;

  const cell = (row: string[], field: ImportField): string => {
    const index = mapping[field];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  table.rows.forEach((row, i) => {
    // The header occupies line 1, so the first body row is line 2 — which is
    // what the operator sees in their spreadsheet.
    const line = i + 2;

    const name = cell(row, 'name');
    const rawAmount = cell(row, 'amount');

    if (!name && !rawAmount) return; // A blank trailing row, not a problem.

    if (!name) {
      problems.push({ line, message: 'Brak nazwy klienta' });
      return;
    }

    const amountCents = parseAmountCents(rawAmount);
    if (amountCents === null) {
      problems.push({ line, message: `Nie udało się odczytać kwoty: „${rawAmount}"` });
      return;
    }
    if (amountCents <= 0) {
      // A zero or a credit note is not a debt. Importing it would put a customer
      // on the ladder for money they do not owe.
      problems.push({ line, message: `Kwota nie jest dodatnia: „${rawAmount}"` });
      return;
    }

    const issueDate = parseDate(cell(row, 'issue_date')) ?? today;
    const dueDate =
      parseDate(cell(row, 'due_date')) ?? addDaysUtc(issueDate, defaultTermDays);

    const email = cell(row, 'email') || null;
    const phone = cell(row, 'phone') || null;
    if (!email && !phone) unreachable += 1;

    rows.push({
      line,
      name,
      email,
      phone,
      vatNumber: cell(row, 'vat_number') || null,
      amountCents,
      dueDate,
      issueDate,
      reference: cell(row, 'reference') || null,
      externalRef: cell(row, 'external_ref') || null,
    });
  });

  return {
    rows,
    problems,
    unreachable,
    totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
  };
}

function addDaysUtc(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
