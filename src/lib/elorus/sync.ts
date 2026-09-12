import { decryptSecret } from '@/lib/crypto';
import { toCents } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DebtorRow, InvoiceStatus, UserRow } from '@/types/database';

import {
  ElorusError,
  fetchContacts,
  fetchInvoices,
  type ElorusContact,
  type ElorusCredentials,
  type ElorusInvoice,
} from './client';

export interface ElorusSyncResult {
  contactsFetched: number;
  debtorsCreated: number;
  debtorsUpdated: number;
  invoicesFetched: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  skipped: number;
  /** Documents matched to one already read from myDATA, on the MARK. */
  reconciled: number;
}

export function credentialsFor(user: UserRow): ElorusCredentials {
  if (!user.elorus_api_key_enc || !user.elorus_organization_id) {
    throw new ElorusError('Elorus is not connected for this account.');
  }

  return {
    apiKey: decryptSecret(user.elorus_api_key_enc),
    organizationId: user.elorus_organization_id,
  };
}

/** The address to write on the customer: the primary one, else the first. */
function pickEmail(contact: ElorusContact): string | null {
  const list = contact.email ?? [];
  return (list.find((e) => e.primary) ?? list[0])?.email ?? null;
}

function pickPhone(contact: ElorusContact): string | null {
  const list = contact.phones ?? [];
  return (list.find((p) => p.primary) ?? list[0])?.number ?? null;
}

function contactName(contact: ElorusContact): string {
  const parts = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return (
    contact.display_name?.trim() ||
    contact.company?.trim() ||
    parts ||
    (contact.vat_number ? `ΑΦΜ ${contact.vat_number}` : '—')
  );
}

/**
 * The document number as printed.
 *
 * `representation` reads "Απόδειξη παροχής υπηρεσιών #ΑΠΥ-Β-41" — everything
 * after the hash is what the creditor and their customer recognise. `number`
 * alone is not enough: it is scoped to a numbering sequence, and this account
 * has two different documents both numbered 42.
 */
function documentNumber(invoice: ElorusInvoice): string | null {
  const fromRepresentation = invoice.representation?.split('#').slice(1).join('#').trim();
  if (fromRepresentation) return fromRepresentation;
  return invoice.number === null || invoice.number === undefined
    ? null
    : String(invoice.number);
}

function mapStatus(status: ElorusInvoice['status']): InvoiceStatus | null {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'void':
      return 'cancelled';
    case 'issued':
    case 'overdue':
      return 'pending';
    default:
      // Drafts are not receivables — they have not been issued to anyone.
      return null;
  }
}

/**
 * Pulls customers and documents from Elorus.
 *
 * Elorus is the source of record because it holds what myDATA drops: a name on
 * every document, an email on most, and the real per-document due date. The
 * MARK travels along too, so a document already read from AADE is updated in
 * place rather than duplicated.
 */
export async function syncElorusForUser(user: UserRow): Promise<ElorusSyncResult> {
  const supabase = createAdminClient();
  const credentials = credentialsFor(user);

  const [contacts, invoices] = await Promise.all([
    fetchContacts(credentials),
    fetchInvoices(credentials),
  ]);

  const result: ElorusSyncResult = {
    contactsFetched: contacts.length,
    debtorsCreated: 0,
    debtorsUpdated: 0,
    invoicesFetched: invoices.length,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    skipped: 0,
    reconciled: 0,
  };

  // ---- customers -----------------------------------------------------------

  const { data: existingDebtors } = await supabase
    .from('debtors')
    .select('*')
    .eq('user_id', user.id);

  const byElorusId = new Map<string, DebtorRow>();
  const byVat = new Map<string, DebtorRow>();

  for (const debtor of existingDebtors ?? []) {
    if (debtor.elorus_contact_id) byElorusId.set(debtor.elorus_contact_id, debtor);
    if (debtor.vat_number) byVat.set(debtor.vat_number, debtor);
  }

  for (const contact of contacts) {
    if (!contact.is_client) continue;

    const fields = {
      name: contactName(contact),
      vat_number: contact.vat_number || null,
      email: pickEmail(contact),
      phone: pickPhone(contact),
      elorus_contact_id: contact.id,
    };

    // Adopt a customer already created from myDATA rather than making a second
    // one for the same VAT number.
    const existing =
      byElorusId.get(contact.id) ?? (contact.vat_number ? byVat.get(contact.vat_number) : undefined);

    if (existing) {
      const { data } = await supabase
        .from('debtors')
        .update({
          ...fields,
          // Never blank contact details that someone filled in by hand because
          // Elorus happens not to have them.
          email: fields.email ?? existing.email,
          phone: fields.phone ?? existing.phone,
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (data) {
        byElorusId.set(contact.id, data);
        result.debtorsUpdated += 1;
      }
      continue;
    }

    const { data } = await supabase
      .from('debtors')
      .insert({ user_id: user.id, ...fields })
      .select('*')
      .single();

    if (data) {
      byElorusId.set(contact.id, data);
      if (data.vat_number) byVat.set(data.vat_number, data);
      result.debtorsCreated += 1;
    }
  }

  // ---- documents -----------------------------------------------------------

  for (const invoice of invoices) {
    const status = mapStatus(invoice.status);
    if (!status) {
      result.skipped += 1;
      continue;
    }

    const gross = toCents(Number(invoice.total));

    // What Elorus has already collected against this document.
    //
    // This was read only when the document was already fully paid, so a
    // partially-paid invoice arrived at full face value: the customer was then
    // chased for the whole amount and the payment link charged it, taking money
    // they had already handed over and creating a refund to make.
    //
    // A dunning product chases what is outstanding, so that is what the row
    // carries. The collected figure is kept beside it rather than discarded, so
    // the document can still be reconciled against its source.
    const collected = Number.isFinite(Number(invoice.paid))
      ? Math.max(0, toCents(Number(invoice.paid)))
      : 0;

    const outstanding = Math.max(0, gross - collected);

    if (!(gross > 0)) {
      result.skipped += 1;
      continue;
    }

    // The customer: by Elorus id, else by the VAT number denormalised onto the
    // document, else created from the document itself — a document can name a
    // customer that never became a saved contact.
    let debtor = invoice.client ? byElorusId.get(invoice.client) : undefined;

    if (!debtor && invoice.client_vat_number) debtor = byVat.get(invoice.client_vat_number);

    if (!debtor) {
      const { data } = await supabase
        .from('debtors')
        .insert({
          user_id: user.id,
          name: invoice.client_display_name?.trim() || '—',
          vat_number: invoice.client_vat_number || null,
          email: invoice.client_email || null,
          phone: invoice.client_phone_number || null,
          ...(invoice.client ? { elorus_contact_id: invoice.client } : {}),
        })
        .select('*')
        .single();

      if (!data) {
        result.skipped += 1;
        continue;
      }

      debtor = data;
      if (invoice.client) byElorusId.set(invoice.client, data);
      if (data.vat_number) byVat.set(data.vat_number, data);
      result.debtorsCreated += 1;
    }

    // Elorus can still call a document issued or overdue after the last payment
    // lands. Nothing is outstanding, so nothing is owed — and a zero-value
    // receivable left open would be chased for nothing.
    const settled = status === 'paid' || outstanding === 0;

    const fields = {
      debtor_id: debtor.id,
      invoice_number: documentNumber(invoice),
      amount_cents: settled ? gross : outstanding,
      currency: invoice.currency_code || 'EUR',
      issue_date: invoice.date,
      // The whole reason for this integration: a real due date instead of one
      // guessed from a fixed payment-terms setting.
      due_date: invoice.due_date || invoice.date,
      status: settled ? ('paid' as const) : status,
      mark: invoice.mydata_latest_mark,
      elorus_invoice_id: invoice.id,
      source: 'elorus' as const,
      // On a settled document this is what was taken. On an open one it is what
      // has been taken so far, which is why `amount_cents` above is the
      // remainder rather than the face value.
      ...(collected > 0 ? { paid_amount_cents: collected } : {}),
    };

    const { data: byId } = await supabase
      .from('invoices')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('elorus_invoice_id', invoice.id)
      .maybeSingle();

    // Not yet known by its Elorus id — but it may already be here from myDATA.
    const { data: byMark } =
      !byId && invoice.mydata_latest_mark
        ? await supabase
            .from('invoices')
            .select('id, status')
            .eq('user_id', user.id)
            .eq('mark', invoice.mydata_latest_mark)
            .maybeSingle()
        : { data: null };

    const existing = byId ?? byMark;

    if (existing) {
      // Settlement recorded here is our own source of truth; Elorus saying
      // "issued" must not undo a payment taken through the platform.
      const keepPaid = existing.status === 'paid' && status !== 'paid';
      await supabase
        .from('invoices')
        .update(keepPaid ? { ...fields, status: 'paid' } : fields)
        .eq('id', existing.id);

      result.invoicesUpdated += 1;
      if (!byId && byMark) result.reconciled += 1;
      continue;
    }

    const { error } = await supabase.from('invoices').insert({ user_id: user.id, ...fields });

    if (error) {
      result.skipped += 1;
      continue;
    }
    result.invoicesCreated += 1;
  }

  await supabase
    .from('users')
    .update({ elorus_last_sync_at: new Date().toISOString() })
    .eq('id', user.id);

  return result;
}
