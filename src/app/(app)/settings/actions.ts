'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { parseSlotKey } from '@/lib/dunning/templates';
import { saveFailed } from '@/lib/errors';
import { formError, getDictionary } from '@/lib/i18n';
import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_TIMEZONE, isTimezone } from '@/lib/money';

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
  business_mode: z.enum(['general', 'landlord']).default('general'),
  timezone: z
    .string()
    .trim()
    .max(64)
    .default(DEFAULT_TIMEZONE)
    .refine(isTimezone, { message: 'invalidTimezone' }),
  reply_to_email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: 'invalidReplyEmail',
    }),
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
    business_mode: formData.get('business_mode') ?? 'general',
    // Validated against the runtime's own list rather than a pattern: a name
    // that looks plausible and does not exist would be stored happily and then
    // silently fall back on every date the product prints.
    timezone: formData.get('timezone') ?? DEFAULT_TIMEZONE,
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const supabase = await createClient();
  // The company being worked in. Null covers both "not signed in" and "member
  // of nothing", which are the same answer here.
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  // Only the columns granted to `authenticated` are touched here; credentials
  // and balances are unreachable from this path by construction.
  const { error } = await supabase.from('users').update(parsed.data).eq('id', org.id);
  if (error) return { error: saveFailed(t, 'settings', error) };

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: t.forms.success.settingsSaved };
}

/**
 * Turns one channel on or off for the whole account.
 *
 * Above the per-step choice rather than instead of it. A tenant who does not
 * want text messages at all was left editing every rung of the scenario to take
 * 'sms' out of each, which is a per-step answer to a question about the account
 * — and says nothing about the rungs they have not configured yet.
 *
 * Nothing is rewritten when this is switched: the scenario keeps its channels
 * and the narrowing happens per send, so turning a channel back on restores the
 * steps exactly as they were instead of leaving somebody to rebuild them.
 */
export async function setChannel(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  const channel = String(formData.get('channel') ?? '');
  if (channel !== 'email' && channel !== 'sms') {
    return { error: t.forms.errors.invalidData };
  }

  // Anything that is not an explicit "on" means off, the same reading the master
  // switch takes: a malformed request stops messages rather than starting them.
  const enabled = formData.get('enabled') === 'on';

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const { error } = await supabase
    .from('users')
    .update(channel === 'email' ? { email_enabled: enabled } : { sms_enabled: enabled })
    .eq('id', org.id);

  if (error) return { error: saveFailed(t, 'settings', error) };

  revalidatePath('/settings');
  revalidatePath('/dashboard');

  return { success: t.forms.success.settingsSaved };
}

/**
 * Turns the whole reminder automation on or off.
 *
 * Deliberately not part of the profile form. It used to ride along with the
 * company name, which meant saving an unrelated field re-sent whatever the
 * checkbox happened to show — and a form that silently decides whether 290
 * invoices get chased is the wrong shape for a setting this consequential.
 *
 * Written through the browser session: `automation_enabled` is in the update
 * grant for `authenticated`, so RLS confines it to the tenant's own row.
 */
export async function setAutomation(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  // Anything that is not an explicit "on" means off. Off is the safe reading of
  // a malformed request: it stops messages rather than starting them.
  const enabled = formData.get('enabled') === 'on';

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const { error } = await supabase
    .from('users')
    .update({ automation_enabled: enabled })
    .eq('id', org.id);

  if (error) return { error: saveFailed(t, 'settings', error) };

  revalidatePath('/settings');
  revalidatePath('/dashboard');

  return {
    success: enabled ? t.forms.success.automationOn : t.forms.success.automationOff,
  };
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
  const provider =
    raw === 'stripe' || raw === 'viva' || raw === 'revolut' ? raw : null;

  // Verified against the membership list rather than taken from the cookie:
  // this writes with the service role, which has no policy behind it.
  const org = await writableOrganization();
  if (!org) return;

  const { error } = await createAdminClient()
    .from('users')
    .update({ payment_provider: provider })
    .eq('id', org.id);
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
    .max(4000, 'textTooLong')
    // A reminder that asks for money without saying how to pay it wastes the
    // contact and the credit. The renderer puts the link back if it is missing,
    // but silently repairing a template a person is looking at is worse than
    // telling them, so the editor refuses it here.
    .refine((v) => v.includes('{{pay_url}}'), 'payUrlRequired'),
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
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

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
        user_id: org.id,
        step: slot.step,
        variant: slot.variant,
        channel: slot.channel,
        subject,
        body: parsed.data.body,
      });

  if (error) return { error: saveFailed(t, 'settings', error) };

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

  if (error) return { error: saveFailed(t, 'settings', error) };

  revalidatePath('/settings');
  return { success: t.forms.success.templateReset };
}

/**
 * Turns the payment notice on or off.
 *
 * Its own action rather than a field on the profile form, for the reason the
 * automation switch is: a two-state preference with a Save button beside it
 * invites the reading that nothing happened until you press Save.
 */
export async function setPaymentNotice(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = await getDictionary();

  // Anything that is not an explicit "on" means off — the safe reading of a
  // malformed request is fewer emails, not more.
  const enabled = formData.get('enabled') === 'on';

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };
  const { error } = await supabase
    .from('users')
    .update({ notify_on_payment: enabled })
    .eq('id', org.id);

  if (error) return { error: error.message };

  revalidatePath('/settings');

  return {
    success: enabled ? t.forms.success.paymentNoticeOn : t.forms.success.paymentNoticeOff,
  };
}
