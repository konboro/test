'use server';

import { revalidatePath } from 'next/cache';

import { getDictionary } from '@/lib/i18n';
import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface ScanRuleState {
  error?: string;
  success?: string;
}

/**
 * Deciding what the reader is allowed to know.
 *
 * The only path from a correction to a change in how documents are read. It is
 * a person pressing a button, and the record says who and when — a rule in
 * force should always be answerable for.
 */
async function decide(id: string, status: 'approved' | 'rejected'): Promise<ScanRuleState> {
  const t = await getDictionary();

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  const admin = createAdminClient();

  // Ownership is checked here because the write goes through the service role,
  // and the id came from a form.
  const { data: rule } = await admin
    .from('scan_rules')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();

  if (!rule || rule.user_id !== org.id) return { error: t.forms.errors.unauthorized };
  if (rule.status !== 'proposed') return { error: t.scanRules.alreadyDecided };

  const { error } = await admin
    .from('scan_rules')
    .update({
      status,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'proposed');

  if (error) return { error: error.message };

  revalidatePath('/settings/reminders');
  return { success: status === 'approved' ? t.scanRules.approved : t.scanRules.rejected };
}

export async function approveScanRule(id: string): Promise<ScanRuleState> {
  return decide(id, 'approved');
}

export async function rejectScanRule(id: string): Promise<ScanRuleState> {
  return decide(id, 'rejected');
}

/**
 * Takes back a rule that is already in force.
 *
 * Approval has to be reversible or it is not a decision, it is a commitment.
 * Withdrawn rather than deleted: what the reader believed, and when, stays
 * readable afterwards.
 */
export async function withdrawScanRule(id: string): Promise<ScanRuleState> {
  const t = await getDictionary();

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const admin = createAdminClient();

  const { data: rule } = await admin
    .from('scan_rules')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!rule || rule.user_id !== org.id) return { error: t.forms.errors.unauthorized };

  const { error } = await admin
    .from('scan_rules')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'approved');

  if (error) return { error: error.message };

  revalidatePath('/settings/reminders');
  return { success: t.scanRules.withdrawn };
}
