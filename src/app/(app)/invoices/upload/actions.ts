'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { getDictionary } from '@/lib/i18n';
import { commitImport } from '@/lib/import/commit';
import { parseAmountCents, type ImportRow } from '@/lib/import/parse';
import { readInvoiceDocument } from '@/lib/invoice-scan/read';
import { visionReader } from '@/lib/invoice-scan/vision';
import { athensDate } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized' };

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'no_files' };
  if (files.length > MAX_FILES) return { error: 'too_many' };

  const admin = createAdminClient();

  const { data: profile } = await supabase
    .from('users')
    .select('vat_number')
    .eq('id', user.id)
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
    const path = `${user.id}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error('[invoice-scan] upload', uploadError);
      return { error: (await getDictionary()).forms.errors.uploadFailed };
    }

    const result = await readInvoiceDocument(
      { bytes, mimeType: file.type },
      { ownVatNumber: profile?.vat_number ?? null, vision: visionReader() ?? undefined },
    );

    await admin.from('invoice_uploads').insert({
      user_id: user.id,
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized' };

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
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();

  if (!upload || upload.user_id !== user.id) return { error: 'missing' };
  if (upload.status !== 'pending') return { error: 'already_done' };

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
  const outcome = await commitImport(user.id, [row], await getDictionary());
  if (outcome.errors.length > 0) return { error: outcome.errors[0] };

  // Link the document to what it became, so a disputed reminder can be answered
  // by producing the invoice it was based on. Only attempted when the document
  // carries a number: without one there is nothing that identifies the new row
  // among a tenant's invoices, and a confident wrong link is worse than none.
  const created = row.reference
    ? (
        await admin
          .from('invoices')
          .select('id')
          .eq('user_id', user.id)
          .eq('invoice_number', row.reference)
          .eq('amount_cents', row.amountCents)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data
    : null;

  await admin
    .from('invoice_uploads')
    .update({
      status: 'committed',
      invoice_id: created?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  revalidatePath('/invoices/upload');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');

  return { read: outcome.invoicesCreated };
}

/** Drops a proposal. The stored file stays: it is evidence, not scratch. */
export async function discardUpload(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await createAdminClient()
    .from('invoice_uploads')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  revalidatePath('/invoices/upload');
}
