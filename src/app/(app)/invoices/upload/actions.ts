'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { getDictionary } from '@/lib/i18n';
import { commitImport } from '@/lib/import/commit';
import { parseAmountCents, type ImportRow } from '@/lib/import/parse';
import { readInvoiceDocument } from '@/lib/invoice-scan/read';
import { visionReader } from '@/lib/invoice-scan/vision';
import { athensDate } from '@/lib/money';
import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { noticeOnIssue } from '@/lib/dunning/issue-notice';
import { loadScenario } from '@/lib/dunning/engine';
import { invoiceScenarioProblem, parseInvoiceScenario } from '@/lib/dunning/invoice-scenario';
import { correctionsBetween, describeCorrections } from '@/lib/invoice-scan/corrections';

export interface UploadState {
  error?: string;
  read?: number;
  needsAttention?: number;
}

const BUCKET = 'invoice-uploads';

/** Mirrors the bucket's own allow-list, so a refusal happens before the upload. */
const ACCEPTED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_BYTES = 20 * 1024 * 1024;
/** One drop, not a migration. The CSV importer is the tool for a whole book. */
const MAX_FILES = 25;

/**
 * Takes dropped files, stores them, and reads what it can into a proposal.
 *
 * Nothing here creates an invoice. Each file becomes a row awaiting review, and
 * a file we could not read becomes a row with empty fields rather than being
 * rejected — the operator can still type what it says, which is strictly better
 * than handing back an error and keeping the document.
 */
export async function uploadInvoiceDocuments(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return { error: 'unauthorized' };

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'no_files' };
  if (files.length > MAX_FILES) return { error: 'too_many' };

  const admin = createAdminClient();

  const { data: profile } = await supabase
    .from('users')
    .select('vat_number, company_name, email, phone')
    .eq('id', org.id)
    .maybeSingle();

  let read = 0;
  let needsAttention = 0;

  for (const file of files) {
    const extension = ACCEPTED[file.type];
    if (!extension) return { error: 'bad_type' };
    if (file.size > MAX_BYTES) return { error: 'too_big' };

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Tenant id first in the path. Nothing reads the bucket directly — every
    // access is brokered by the server role — but a layout where one tenant's
    // objects are namespaced under their own id is the one that stays safe if
    // that ever changes.
    const path = `${org.id}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error('[invoice-scan] upload', uploadError);
      return { error: (await getDictionary()).forms.errors.uploadFailed };
    }

    const result = await readInvoiceDocument(
      { bytes, mimeType: file.type },
      {
        ownVatNumber: profile?.vat_number ?? null,
        ownName: profile?.company_name ?? null,
        // So the reader cannot hand back the tenant's own letterhead details as
        // the customer's, which on an invoice with no other contact on it is
        // exactly what it would otherwise do.
        ownEmail: profile?.email ?? null,
        ownPhone: profile?.phone ?? null,
        vision: visionReader() ?? undefined,
      },
    );

    await admin.from('invoice_uploads').insert({
      user_id: org.id,
      storage_path: path,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      source: result.source,
      extracted: { ...result.fields, problem: result.problem ?? null },
      missing: result.missing,
    });

    read += 1;
    if (result.missing.length > 0) needsAttention += 1;
  }

  revalidatePath('/invoices/upload');
  return { read, needsAttention };
}

/**
 * Turns a reviewed proposal into a real invoice.
 *
 * Goes through the same commit the CSV importer uses, deliberately. That path
 * already matches an existing customer by VAT number, email or reference before
 * creating one, and already refuses to insert a row it has seen before — none of
 * which is worth reimplementing next to it, and all of which would eventually
 * disagree with it if it were.
 *
 * The values written are the ones on screen, not the ones extracted: a field the
 * operator corrected is the field that counts.
 */
export async function commitUpload(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const org = await writableOrganization();
  if (!org) return { error: 'unauthorized' };

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'missing' };

  const text = (key: string) => {
    const value = String(formData.get(key) ?? '').trim();
    return value === '' ? null : value;
  };

  const name = text('debtorName');
  // Typed the way it is written on the document — "1.240,00" — and converted
  // by the same parser the CSV importer uses, so the two paths cannot disagree
  // about what a comma means.
  const amount = parseAmountCents(String(formData.get('amount') ?? ''));
  const issueDate = text('issueDate');
  const dueDate = text('dueDate') ?? issueDate;

  if (!name) return { error: 'need_name' };
  if (amount === null || amount <= 0) return { error: 'need_amount' };
  if (!issueDate) return { error: 'need_issue_date' };

  const admin = createAdminClient();

  // Ownership check: the id came from a form, and the service role below does
  // not apply the policy that would otherwise confine this to the tenant.
  const { data: upload } = await admin
    .from('invoice_uploads')
    .select('id, user_id, status, filename, source, extracted')
    .eq('id', id)
    .maybeSingle();

  if (!upload || upload.user_id !== org.id) return { error: 'missing' };
  if (upload.status !== 'pending') return { error: 'already_done' };

  const saved = {
    debtorName: name,
    vatNumber: text('vatNumber'),
    invoiceNumber: text('invoiceNumber'),
    issueDate,
    dueDate,
    amountCents: amount,
    email: text('email'),
    phone: text('phone'),
  };

  // Said out loud as well as stored. A correction in the log is how a fault in
  // the reader gets noticed within the hour rather than on the day somebody
  // thinks to go looking for it.
  const corrections = correctionsBetween(upload.extracted, saved);
  if (corrections.length) {
    console.info('[invoice-scan] corrected', {
      file: upload.filename,
      source: upload.source,
      changes: describeCorrections(corrections),
    });
  }

  const row: ImportRow = {
    line: 1,
    name,
    email: text('email'),
    phone: text('phone'),
    vatNumber: text('vatNumber'),
    amountCents: amount,
    issueDate,
    // A due date is required downstream and drives the whole ladder. Falling
    // back to the issue date states "due on receipt" rather than inventing terms
    // the document does not carry; the operator can move it afterwards.
    dueDate: dueDate ?? athensDate(),
    reference: text('invoiceNumber'),
    externalRef: null,
    // A scanned invoice has no leftover columns; the reviewer typed the fields.
    notes: null,
  };

  // `commitImport` reports in the reader's language now rather than pasting the
  // database's own words into the page, so it needs the dictionary.
  const cadence = parseInvoiceScenario(formData, await loadScenario(org.id));
  if (invoiceScenarioProblem(cadence)) return { error: 'scenario' };

  const outcome = await commitImport(org.id, [row], await getDictionary());
  if (outcome.errors.length > 0) return { error: outcome.errors[0] };

  // Link the document to what it became. This is what puts the scan behind the
  // invoice number, both in the list and on the page the debtor is sent to, so
  // the link has to be established for every upload rather than only for the
  // ones that carried a readable number.
  //
  // Matched on amount and issue date, narrowed by the number when there is one,
  // newest first. The commit that just ran is the only thing that could have
  // created a row with this combination a moment ago.
  let finder = admin
    .from('invoices')
    .select('id')
    .eq('user_id', org.id)
    .eq('amount_cents', row.amountCents)
    .eq('issue_date', row.issueDate);

  if (row.reference) finder = finder.eq('invoice_number', row.reference);

  const { data: created } = await finder
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await admin
    .from('invoice_uploads')
    .update({
      status: 'committed',
      invoice_id: created?.id ?? null,
      // What was actually saved, beside what the reader proposed. Where the two
      // differ is a defect in the reader, recorded with the document still in
      // storage next to it — which is the difference between "the scanning is
      // bad" and a named template with a failing case somebody can fix.
      confirmed: saved,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  // What the operator chose beside this reading. Applied before the notice
  // goes out, because "no automatic reminders" has to mean the notice too — and
  // that is the very next thing to happen.
  if (created?.id && cadence.mode !== 'default') {
    await admin
      .from('invoices')
      .update({
        scenario_mode: cadence.mode,
        automation_enabled: cadence.mode !== 'off',
      })
      .eq('id', created.id);

    if (cadence.rows.length) {
      await admin
        .from('invoice_dunning_steps')
        .insert(cadence.rows.map((step) => ({ ...step, invoice_id: created.id })));
    }
  }

  // Confirming the reading is the deliberate act, not dropping the file in —
  // the fields were still being checked until this point. So this is where the
  // customer gets told, and not a moment earlier.
  if (created?.id) await noticeOnIssue(org.id, created.id);

  revalidatePath('/invoices/upload');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');

  return { read: outcome.invoicesCreated };
}

/** Drops a proposal. The stored file stays: it is evidence, not scratch. */
export async function discardUpload(formData: FormData): Promise<void> {
  const org = await writableOrganization();
  if (!org) return;

  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await createAdminClient()
    .from('invoice_uploads')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', org.id);

  revalidatePath('/invoices/upload');
}