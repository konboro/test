'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseSlotKey } from '@/lib/dunning/templates';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

export interface SettingsState {
  error?: string;
  success?: string;
}

const profileSchema = z.object({
  company_name: z.string().trim().min(1, 'Η επωνυμία είναι υποχρεωτική.').max(200),
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
      message: 'Μη έγκυρο email απάντησης.',
    }),
  default_payment_terms_days: z.coerce
    .number()
    .int()
    .min(0, 'Οι ημέρες πίστωσης δεν μπορούν να είναι αρνητικές.')
    .max(365),
  automation_enabled: z.boolean(),
});

export async function updateProfile(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = profileSchema.safeParse({
    company_name: formData.get('company_name'),
    vat_number: formData.get('vat_number'),
    reply_to_email: formData.get('reply_to_email'),
    default_payment_terms_days: formData.get('default_payment_terms_days'),
    automation_enabled: formData.get('automation_enabled') === 'on',
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  // Only the columns granted to `authenticated` are touched here; credentials
  // and balances are unreachable from this path by construction.
  const { error } = await supabase.from('users').update(parsed.data).eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: 'Οι ρυθμίσεις αποθηκεύτηκαν.' };
}

/**
 * Switches the portal language.
 *
 * Written to both the account and a cookie: the account is the durable
 * preference that follows the tenant to a new browser, the cookie is what every
 * subsequent render reads so a page does not have to query for it.
 */
export async function updateLocale(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  if (!isLocale(locale)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from('users').update({ locale }).eq('id', user.id);
  if (error) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  // The language lives in the layout chrome too, so the whole tree has to go.
  revalidatePath('/', 'layout');
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
    .min(1, 'Το κείμενο δεν μπορεί να είναι κενό.')
    .max(4000, 'Το κείμενο είναι πολύ μεγάλο.'),
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
  const parsed = templateSchema.safeParse({
    slot: formData.get('slot'),
    subject: formData.get('subject'),
    body: formData.get('body'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρο κείμενο.' };

  const slot = parseSlotKey(parsed.data.slot);
  if (!slot) return { error: 'Άγνωστο πρότυπο.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  const lookup = supabase.from('message_templates').select('id').eq('channel', slot.channel);
  const { data: existing } = await (slot.step === null
    ? lookup.is('step', null)
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
        channel: slot.channel,
        subject,
        body: parsed.data.body,
      });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: 'Το πρότυπο αποθηκεύτηκε.' };
}

/** Drops the override, so the slot falls back to the built-in copy. */
export async function resetTemplate(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const slot = parseSlotKey(String(formData.get('slot') ?? ''));
  if (!slot) return { error: 'Άγνωστο πρότυπο.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  const deletion = supabase.from('message_templates').delete().eq('channel', slot.channel);
  const { error } = await (slot.step === null
    ? deletion.is('step', null)
    : deletion.eq('step', slot.step));

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: 'Επαναφέρθηκε το προεπιλεγμένο κείμενο.' };
}
