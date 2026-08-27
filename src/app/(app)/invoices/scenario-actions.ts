'use server';

import { revalidatePath } from 'next/cache';

import { loadScenario } from '@/lib/dunning/engine';
import { invoiceScenarioProblem, parseInvoiceScenario } from '@/lib/dunning/invoice-scenario';
import { saveFailed } from '@/lib/errors';
import { getDictionary } from '@/lib/i18n';
import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';

export interface InvoiceScenarioState {
  error?: string;
  success?: string;
}

/**
 * Changes what happens to one invoice.
 *
 * Runs under the service role, so ownership is checked here rather than left to
 * RLS. The override rows are replaced wholesale rather than merged: a step the
 * form did not send is a step the operator removed from the override, and
 * merging would keep it alive invisibly.
 */
export async function saveInvoiceScenario(
  _prev: InvoiceScenarioState,
  formData: FormData,
): Promise<InvoiceScenarioState> {
  const t = await getDictionary();

  const invoiceId = String(formData.get('id') ?? '');
  if (!invoiceId) return { error: t.forms.errors.unknownTemplate };

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, user_id')
    .eq('id', invoiceId)
    .maybeSingle();

  if (!invoice || invoice.user_id !== org.id) return { error: t.forms.errors.unauthorized };

  const cadence = parseInvoiceScenario(formData, await loadScenario(org.id));
  const problem = invoiceScenarioProblem(cadence);
  if (problem) return { error: t.scenario[problem] };

  const { error: modeError } = await admin
    .from('invoices')
    .update({
      scenario_mode: cadence.mode,
      // The row switch has always written this one; the two disagreeing would
      // mean the invoice is chased or not depending on which a reader checks.
      automation_enabled: cadence.mode !== 'off',
    })
    .eq('id', invoiceId);

  if (modeError) return { error: saveFailed(t, 'invoices:scenario', modeError) };

  // Cleared for every mode, not only when switching away from custom: the rows
  // are meaningless unless the mode says to read them, and leaving them behind
  // would resurrect an old override the next time somebody chose custom.
  const { error: clearError } = await admin
    .from('invoice_dunning_steps')
    .delete()
    .eq('invoice_id', invoiceId);

  if (clearError) return { error: saveFailed(t, 'invoices:scenario', clearError) };

  if (cadence.rows.length) {
    const { error: rowsError } = await admin
      .from('invoice_dunning_steps')
      .insert(cadence.rows.map((row) => ({ ...row, invoice_id: invoiceId })));

    if (rowsError) return { error: saveFailed(t, 'invoices:scenario', rowsError) };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');

  return { success: t.invoiceScenario.saved };
}
