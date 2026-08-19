import { createAdminClient } from '@/lib/supabase/admin';

import { slotKey, type TemplateOverrides, type TemplateVariant } from './templates';

/**
 * A tenant's template overrides, keyed by slot.
 *
 * Loaded once per tenant per sweep rather than per message: a tenant with two
 * hundred overdue invoices has exactly one set of templates, and reading them
 * back for every send would turn a cheap lookup into the bulk of the run.
 *
 * A tenant with no overrides yields an empty object, and every render falls back
 * to the built-in copy.
 */
export async function loadTemplateOverrides(userId: string): Promise<TemplateOverrides> {
  const { data } = await createAdminClient()
    .from('message_templates')
    .select('step, channel, variant, subject, body')
    .eq('user_id', userId);

  const overrides: TemplateOverrides = {};

  for (const row of data ?? []) {
    overrides[slotKey(row.step, row.channel, row.variant as TemplateVariant)] = {
      subject: row.subject,
      body: row.body,
    };
  }

  return overrides;
}
