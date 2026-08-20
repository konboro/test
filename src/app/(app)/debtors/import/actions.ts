'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { commitImport, type ImportOutcome } from '@/lib/import/commit';
import { buildPreview, guessColumns, parseCsv, type ImportField } from '@/lib/import/parse';
import { suggestMapping } from '@/lib/import/ai-mapping';
import { readSpreadsheet, tableToTsv } from '@/lib/import/sheet';
import { athensDate } from '@/lib/money';
import { getDictionary } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

export interface ImportState {
  error?: string;
  outcome?: ImportOutcome;
}

export interface SheetReadResult {
  error?: string;
  /** The sheet as tab-separated text, ready for the same parser CSV uses. */
  text?: string;
  sheetName?: string;
  sheets?: string[];
  headerRow?: number;
  truncated?: boolean;
  /** The best mapping we have, for the screen to show and the operator to fix. */
  mapping?: Partial<Record<ImportField, number>>;
  /** Whether the header words were enough, or a model had to be asked. */
  mappedBy?: 'headers' | 'ai';
}

/** Mirrors what a spreadsheet reader can actually open. */
const SHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
];

const MAX_SHEET_BYTES = 15 * 1024 * 1024;

/**
 * Turns an uploaded workbook into the text the CSV path already understands.
 *
 * Deliberately a conversion step rather than a second importer. Everything after
 * this — the column mapping, the row-by-row validation, the preview, the commit
 * that matches an existing customer before creating one — is the code that is
 * already written and already tested. A parallel spreadsheet importer would
 * drift from it, and the drift would show up as duplicate customers.
 *
 * Runs on the server because the parser has no business in a browser bundle,
 * and because the file never needs to leave the request.
 */
export async function readSheetFile(formData: FormData): Promise<SheetReadResult> {
  const t = await getDictionary();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: t.importer.sheetErrors.empty };
  if (file.size > MAX_SHEET_BYTES) return { error: t.importer.sheetErrors.tooBig };

  const looksRight =
    SHEET_TYPES.includes(file.type) || /\.xlsx$|\.xlsm$/i.test(file.name);
  if (!looksRight) return { error: t.importer.sheetErrors.badType };

  try {
    const table = await readSpreadsheet(new Uint8Array(await file.arrayBuffer()));
    if (!table || table.rows.length === 0) return { error: t.importer.sheetErrors.noRows };

    const { mapping, mappedBy } = await mapColumns(table.headers, table.rows);

    return {
      text: tableToTsv(table),
      sheetName: table.sheetName,
      sheets: table.sheets,
      headerRow: table.headerRow,
      truncated: table.truncated,
      mapping,
      mappedBy,
    };
  } catch (cause) {
    // A password-protected or corrupt workbook is a normal thing to be handed.
    console.error('[import:sheet]', String(cause));
    return { error: t.importer.sheetErrors.unreadable };
  }
}

/**
 * The column mapping, asking a model only if the header words were not enough.
 *
 * Deterministic first, always: the guesser is free, instant and tested, and it
 * handles the ordinary export. The model is consulted only when the two fields
 * without which nothing can be imported — who owes, and how much — are still
 * unmapped, and even then whatever the guesser did work out is kept: a header
 * that plainly says "E-mail" does not need a second opinion.
 */
async function mapColumns(
  headers: string[],
  rows: string[][],
): Promise<{ mapping: Partial<Record<ImportField, number>>; mappedBy: 'headers' | 'ai' }> {
  const guessed = guessColumns(headers);
  if (guessed.name !== undefined && guessed.amount !== undefined) {
    return { mapping: guessed, mappedBy: 'headers' };
  }

  const suggested = await suggestMapping(headers, rows);
  if (!suggested) return { mapping: guessed, mappedBy: 'headers' };

  // The guesser wins every column it claimed; the model only fills the holes.
  const merged: Partial<Record<ImportField, number>> = { ...suggested, ...guessed };
  return { mapping: merged, mappedBy: 'ai' };
}

/**
 * The same help for a pasted table or a CSV, which the browser parses itself.
 */
export async function assistMapping(
  headers: string[],
  rows: string[][],
): Promise<{ mapping: Partial<Record<ImportField, number>>; mappedBy: 'headers' | 'ai' }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { mapping: {}, mappedBy: 'headers' };

  return mapColumns(headers, rows);
}

const FIELDS = [
  'name',
  'email',
  'phone',
  'vat_number',
  'amount',
  'due_date',
  'issue_date',
  'reference',
  'external_ref',
] as const;

const schema = z.object({
  // The file itself, not the rows the browser made of it. 150 debts is a few
  // tens of kilobytes; the cap is there to stop a paste, not to size a document.
  text: z.string().min(1).max(2_000_000),
  mapping: z.record(z.enum(FIELDS), z.number().int().min(0).max(200)),
  termDays: z.number().int().min(0).max(365).default(0),
});

/**
 * Imports a book of debts from a spreadsheet.
 *
 * The server parses the file again rather than trusting the rows the browser
 * sent. The preview on screen is a preview — convenient, and computed by the
 * same functions — but what gets written is what this parse produces, so a
 * tampered payload cannot write an amount nobody saw.
 *
 * The tenant id comes from the session and is stamped on every row, so nothing
 * in an uploaded file can direct a debt onto another account.
 */
export async function runImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.importer.errors.session };

  let parsedInput;
  try {
    parsedInput = schema.parse({
      text: String(formData.get('text') ?? ''),
      mapping: JSON.parse(String(formData.get('mapping') ?? '{}')),
      termDays: Number(formData.get('term_days') ?? 0),
    });
  } catch {
    return { error: t.importer.errors.invalid };
  }

  const table = parseCsv(parsedInput.text);
  const preview = buildPreview(
    table,
    parsedInput.mapping as Partial<Record<ImportField, number>>,
    athensDate(),
    parsedInput.termDays,
  );

  if (!preview.rows.length) {
    return { error: t.importer.errors.noRows };
  }

  const outcome = await commitImport(user.id, preview.rows, t);

  revalidatePath('/debtors');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');

  return { outcome };
}
