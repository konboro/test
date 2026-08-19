'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { commitImport, type ImportOutcome } from '@/lib/import/commit';
import { buildPreview, parseCsv, type ImportField } from '@/lib/import/parse';
import { athensDate } from '@/lib/money';
import { getDictionary } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

export interface ImportState {
  error?: string;
  outcome?: ImportOutcome;
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

  const outcome = await commitImport(user.id, preview.rows);

  revalidatePath('/debtors');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');

  return { outcome };
}
