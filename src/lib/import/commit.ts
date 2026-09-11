import { createHash } from 'node:crypto';

import { normaliseCurrency } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n';
import { createAdminClient } from '@/lib/supabase/admin';

import type { Database } from '@/types/database';

import type { ImportRow } from './parse';

type InvoiceInsert = Database['public']['Tables']['invoices']['Insert'];

export interface ImportOutcome {
  debtorsCreated: number;
  debtorsMatched: number;
  invoicesCreated: number;
  /** Rows already present from an earlier upload of the same file. */
  duplicates: number;
  errors: string[];
}

/**
 * A stable identifier for a row the operator did not identify.
 *
 * Re-uploading the same file has to be a no-op, and the only thing that makes
 * that possible is a key both uploads agree on. When the file carries the source
 * system's own id, that is the key and everything works even after the rows are
 * reordered or corrected. Without one, the row's own content stands in — which
 * survives a re-upload of the same file, but not an edited one.
 *
 * That limitation is real and is stated on the screen rather than hidden: a
 * corrected file legitimately creates new rows unless the operator supplies ids.
 */
function rowKey(row: ImportRow, occurrence: number): string {
  if (row.externalRef) return row.externalRef;

  const signature = [
    row.name,
    row.vatNumber ?? '',
    row.amountCents,
    row.dueDate,
    row.issueDate,
    row.reference ?? '',
  ].join('|');

  return `import:${createHash('sha256').update(signature).digest('hex').slice(0, 24)}:${occurrence}`;
}

/**
 * Writes an approved preview into the book.
 *
 * Runs with the service role because it writes two tables the browser cannot,
 * so the tenant id comes from the caller's session and is stamped on every row
 * — nothing in the uploaded file can redirect a debt onto another account.
 */
export async function commitImport(
  userId: string,
  rows: ImportRow[],
  t: Dictionary,
): Promise<ImportOutcome> {
  const admin = createAdminClient();
  const outcome: ImportOutcome = {
    debtorsCreated: 0,
    debtorsMatched: 0,
    invoicesCreated: 0,
    duplicates: 0,
    errors: [],
  };

  if (!rows.length) return outcome;

  const { data: existing, error: loadError } = await admin
    .from('debtors')
    .select('id, name, vat_number, email, external_ref')
    .eq('user_id', userId);

  if (loadError) {
    // The database's own words go to the log, not to the operator. A Postgres
    // error describes our defect in our vocabulary; there is nothing the person
    // holding the spreadsheet can do with it, and pasting it after a Greek
    // sentence is how "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification" ended up on screen.
    console.error('[import] reading existing customers', loadError);
    outcome.errors.push(t.importer.errors.loadCustomers);
    return outcome;
  }

  /**
   * Matching a row to a customer already on file.
   *
   * In descending order of how much the identifier actually proves. The source
   * system's own id is definitive. A VAT number identifies a business. An email
   * usually identifies a person but is shared often enough — one address for a
   * whole family, or an office inbox — that it comes last, and a bare name is
   * not used at all: two customers called "Papadopoulos" are two customers, and
   * merging them would put one person's debt on another's ladder.
   */
  const byExternal = new Map<string, string>();
  const byVat = new Map<string, string>();
  const byEmail = new Map<string, string>();

  for (const debtor of existing ?? []) {
    if (debtor.external_ref) byExternal.set(debtor.external_ref, debtor.id);
    if (debtor.vat_number) byVat.set(debtor.vat_number.trim(), debtor.id);
    if (debtor.email) byEmail.set(debtor.email.trim().toLowerCase(), debtor.id);
  }

  const resolve = (row: ImportRow): string | null =>
    (row.externalRef ? byExternal.get(row.externalRef) : undefined) ??
    (row.vatNumber ? byVat.get(row.vatNumber.trim()) : undefined) ??
    (row.email ? byEmail.get(row.email.trim().toLowerCase()) : undefined) ??
    null;

  // Create the customers that are genuinely new, once each — a file commonly
  // carries several debts for the same person.
  const pending = new Map<string, ImportRow>();

  for (const row of rows) {
    if (resolve(row)) continue;

    const key =
      row.externalRef ?? row.vatNumber?.trim() ?? row.email?.trim().toLowerCase() ?? `name:${row.name}`;
    if (!pending.has(key)) pending.set(key, row);
  }

  if (pending.size) {
    const { data: created, error } = await admin
      .from('debtors')
      .insert(
        [...pending.values()].map((row) => ({
          user_id: userId,
          name: row.name,
          vat_number: row.vatNumber,
          email: row.email,
          phone: row.phone,
          external_ref: row.externalRef,
          // Only on creation. An existing customer may have notes somebody wrote
          // deliberately, and an import is not entitled to overwrite them.
          notes: row.notes,
        })),
      )
      .select('id, name, vat_number, email, external_ref');

    if (error) {
      console.error('[import] creating customers', error);
      outcome.errors.push(t.importer.errors.createCustomers);
      return outcome;
    }

    for (const debtor of created ?? []) {
      outcome.debtorsCreated += 1;
      if (debtor.external_ref) byExternal.set(debtor.external_ref, debtor.id);
      if (debtor.vat_number) byVat.set(debtor.vat_number.trim(), debtor.id);
      if (debtor.email) byEmail.set(debtor.email.trim().toLowerCase(), debtor.id);
      if (!debtor.external_ref && !debtor.vat_number && !debtor.email) {
        // Matched on nothing durable, so later rows in this same file find it by
        // name. Deliberately scoped to this import only.
        byEmail.set(`name:${debtor.name}`, debtor.id);
      }
    }
  }

  const seen = new Map<string, number>();
  // Typed rather than a bag of unknowns, so postgrest checks the shape against
  // the table instead of accepting whatever this loop happens to build.
  const payload: InvoiceInsert[] = [];

  for (const row of rows) {
    const occurrence = seen.get(row.name) ?? 0;
    seen.set(row.name, occurrence + 1);

    const debtorId =
      resolve(row) ?? byEmail.get(`name:${row.name}`) ?? null;

    if (!debtorId) {
      outcome.errors.push(t.importer.errors.rowUnmatched(row.line));
      continue;
    }

    outcome.debtorsMatched += 1;

    payload.push({
      user_id: userId,
      debtor_id: debtorId,
      invoice_number: row.reference,
      amount_cents: row.amountCents,
      currency: normaliseCurrency(row.currency),
      issue_date: row.issueDate,
      due_date: row.dueDate,
      status: 'pending',
      source: 'import',
      external_ref: rowKey(row, occurrence),
    });
  }

  if (!payload.length) return outcome;

  // Which of these the tenant already has.
  //
  // This was `upsert(payload, { onConflict: 'user_id,external_ref' })`, and it
  // could never have worked: the unique index behind that pair is partial —
  // `where external_ref is not null` — and Postgres will only use a partial
  // index to resolve ON CONFLICT if the statement repeats the index predicate.
  // PostgREST sends the column list and nothing else, so the database found no
  // arbiter and refused the entire batch. Every import failed, on every file,
  // with a message about constraint specifications.
  //
  // Asking first is also more truthful about the result: the duplicate count is
  // now the rows actually recognised rather than a subtraction that blamed
  // every unexplained gap on a re-upload.
  const refs = payload
    .map((row) => row.external_ref)
    .filter((ref): ref is string => Boolean(ref));

  const known = new Set<string>();

  // Chunked because this becomes a query string: a few hundred references in
  // one `in` clause is a URL long enough to be refused before it is read.
  for (let at = 0; at < refs.length; at += 200) {
    const { data: seenRows, error: seenError } = await admin
      .from('invoices')
      .select('external_ref')
      .eq('user_id', userId)
      .in('external_ref', refs.slice(at, at + 200));

    if (seenError) {
      console.error('[import] reading existing references', seenError);
      outcome.errors.push(t.importer.errors.saveInvoices);
      return outcome;
    }

    for (const row of seenRows ?? []) {
      if (row.external_ref) known.add(row.external_ref);
    }
  }

  const fresh = payload.filter((row) => !row.external_ref || !known.has(row.external_ref));
  outcome.duplicates = payload.length - fresh.length;
  outcome.debtorsMatched -= outcome.debtorsCreated;

  if (!fresh.length) return outcome;

  const { data: inserted, error } = await admin.from('invoices').insert(fresh).select('id');

  if (error) {
    console.error('[import] saving receivables', error);
    // 23505 is the partial index catching a row this batch had not seen — two
    // uploads of the same file overlapping. Nothing is lost and nothing is
    // wrong with the file, so it is reported as already imported rather than as
    // a failure the operator would go looking for a cause for.
    outcome.errors.push(
      error.code === '23505' ? t.importer.errors.alreadyImported : t.importer.errors.saveInvoices,
    );
    return outcome;
  }

  outcome.invoicesCreated = inserted?.length ?? 0;

  return outcome;
}
