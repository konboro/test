'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { parseSlotKey } from '@/lib/dunning/templates';
import { formError, getDictionary } from '@/lib/i18n';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface SettingsState {
  error?: string;
  success?: string;
}

const profileSchema = z.object({
  company_name: z.string().trim().min(1, 'nameRequired').max(200),
  vat_number: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
  reply_to_email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: 'invalidReplyEmail',
    }),
  automation_enabled: z.boolean(),
});

export async function updateProfile(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  const parsed = profileSchema.safeParse({
    company_name: formData.get('company_name'),
    vat_number: formData.get('vat_number'),
    reply_to_email: formData.get('reply_to_email'),
    automation_enabled: formData.get('automation_enabled') === 'on',
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  // Only the columns granted to `authenticated` are touched here; credentials
  // and balances are unreachable from this path by construction.
  const { error } = await supabase.from('users').update(parsed.data).eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: t.forms.success.settingsSaved };
}


/**
 * Picks which provider the payment button uses.
 *
 * Written with the service role because `payment_provider` is not in the
 * authenticated update grant — the same treatment every other payment column
 * gets, so a browser session can never reach across and repoint another
 * tenant's payments.
 *
 * An empty value clears the preference, which resolves to whichever provider is
 * configured rather than to "none": there is no way to switch payments off from
 * here by accident.
 */
export async function updatePaymentProvider(formData: FormData): Promise<void> {
  const raw = String(formData.get('payment_provider') ?? '');
  const provider = raw === 'stripe' || raw === 'viva' ? raw : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await createAdminClient()
    .from('users')
    .update({ payment_provider: provider })
    .eq('id', user.id);
  if (error) return;

  revalidatePath('/settings');
}

const templateSchema = z.object({
  slot: z.string(),
  subject: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  body: z
    .string()
    .trim()
    .min(1, 'textEmpty')
    .max(4000, 'textTooLong'),
});

/**
 * Stores one template override.
 *
 * The unique index behind a slot is an expression index — `coalesce(step, 'manual')`,
 * needed because null is not distinct from null — and postgrest cannot target an
 * expression in `onConflict`, so this reads first and then inserts or updates
 * rather than upserting.
 */
export async function saveTemplate(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  const parsed = templateSchema.safeParse({
    slot: formData.get('slot'),
    subject: formData.get('subject'),
    body: formData.get('body'),
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const slot = parseSlotKey(parsed.data.slot);
  if (!slot) return { error: t.forms.errors.unknownTemplate };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  // The variant has to narrow the lookup as well as the step: two manual slots
  // now share `step is null`, and matching on the step alone would overwrite
  // whichever of them was stored first.
  const lookup = supabase.from('message_templates').select('id').eq('channel', slot.channel);
  const { data: existing } = await (slot.step === null
    ? (slot.variant ? lookup.eq('variant', slot.variant) : lookup.is('variant', null)).is(
        'step',
        null,
      )
    : lookup.eq('step', slot.step)
  ).maybeSingle();

  const subject = slot.channel === 'email' ? parsed.data.subject : null;

  const { error } = existing
    ? await supabase
        .from('message_templates')
        .update({ subject, body: parsed.data.body })
        .eq('id', existing.id)
    : await supabase.from('message_templates').insert({
        user_id: user.id,
        step: slot.step,
        variant: slot.variant,
        channel: slot.channel,
        subject,
        body: parsed.data.body,
      });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: t.forms.success.templateSaved };
}

/** Drops the override, so the slot falls back to the built-in copy. */
export async function resetTemplate(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  const slot = parseSlotKey(String(formData.get('slot') ?? ''));
  if (!slot) return { error: t.forms.errors.unknownTemplate };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  const deletion = supabase.from('message_templates').delete().eq('channel', slot.channel);
  const { error } = await (slot.step === null
    ? (slot.variant ? deletion.eq('variant', slot.variant) : deletion.is('variant', null)).is(
        'step',
        null,
      )
    : deletion.eq('step', slot.step));

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: t.forms.success.templateReset };
}
