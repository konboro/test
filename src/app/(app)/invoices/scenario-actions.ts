'use server';

import { revalidatePath } from 'next/cache';

import { loadScenario } from '@/lib/dunning/engine';
import { parseInvoiceMessages } from '@/lib/dunning/invoice-messages';
import { invoiceScenarioProblem, parseInvoiceScenario } from '@/lib/dunning/invoice-scenario';
import { effectiveNoticeTexts } from '@/lib/dunning/template-store';
import { saveFailed } from '@/lib/errors';
import { getDictionary, getLocale } from '@/lib/i18n';
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

  // The wording, held to the same contract as the cadence: text identical to
  // the account's effective template is not an override and is not stored.
  const messages = parseInvoiceMessages(
    formData,
    await effectiveNoticeTexts(org.id, await getLocale()),
  );

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

  // Wording rows are replaced wholesale for the same reason the step rows are:
  // a field the form sent back unchanged is not an override any more, and
  // merging would keep the old text alive invisibly. Tolerant of the table
  // missing — the save still lands, the log says why the text did not.
  const { error: clearMessagesError } = await admin
    .from('invoice_messages')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('step', 'on_issue');

  if (clearMessagesError) {
    console.warn('[invoices] invoice_messages clear failed', clearMessagesError.message);
  } else if (messages.length) {
    const { error: messagesError } = await admin
      .from('invoice_messages')
      .insert(messages.map((row) => ({ ...row, invoice_id: invoiceId, user_id: org.id })));

    if (messagesError) return { error: saveFailed(t, 'invoices:messages', messagesError) };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');

  return { success: t.invoiceScenario.saved };
}
