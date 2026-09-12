'use server';

import { revalidatePath } from 'next/cache';

import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Deciding what a debtor's report was worth.
 *
 * All three run under the service role — the table takes no browser writes, so
 * the row a money decision is based on cannot be edited by the session that
 * benefits — and each begins with the same ownership check that RLS would
 * otherwise have made. `resolved_by` records the person, not the company:
 * "which of us dealt with this" is the audit question.
 */

async function ownedOpenReport(reportId: string) {
  const org = await writableOrganization();
  if (!org || !reportId) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: report } = await createAdminClient()
    .from('invoice_reports')
    .select('id, user_id, invoice_id, kind, status')
    .eq('id', reportId)
    .maybeSingle();

  if (!report || report.user_id !== org.id || report.status !== 'open') return null;
  return { org, person: user.id, report };
}

function refresh() {
  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  revalidatePath('/logs');
}

/**
 * "They did pay." Settles the invoice and closes the report in one move —
 * the two facts are the same fact, and leaving either half undone brings the
 * reminders back for a debt that no longer exists.
 */
export async function confirmPaidReport(formData: FormData): Promise<void> {
  const owned = await ownedOpenReport(String(formData.get('id') ?? ''));
  if (!owned || owned.report.kind !== 'paid_claim') return;

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, amount_cents')
    .eq('id', owned.report.invoice_id)
    .eq('user_id', owned.org.id)
    .maybeSingle();

  if (invoice) {
    // The pending guard makes this idempotent against a double click and safe
    // against a webhook that settled the invoice in the meantime.
    await admin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_amount_cents: invoice.amount_cents,
      })
      .eq('id', invoice.id)
      .eq('status', 'pending');
  }

  await admin
    .from('invoice_reports')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: owned.person })
    .eq('id', owned.report.id);

  refresh();
}

/** Closed as handled — a dispute that was talked through, corrected, or agreed. */
export async function resolveReport(formData: FormData): Promise<void> {
  const owned = await ownedOpenReport(String(formData.get('id') ?? ''));
  if (!owned) return;

  await createAdminClient()
    .from('invoice_reports')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: owned.person })
    .eq('id', owned.report.id);

  refresh();
}

/** The claim did not hold up. Chasing resumes with the next sweep. */
export async function dismissReport(formData: FormData): Promise<void> {
  const owned = await ownedOpenReport(String(formData.get('id') ?? ''));
  if (!owned) return;

  await createAdminClient()
    .from('invoice_reports')
    .update({
      status: 'dismissed',
      resolved_at: new Date().toISOString(),
      resolved_by: owned.person,
    })
    .eq('id', owned.report.id);

  refresh();
}
