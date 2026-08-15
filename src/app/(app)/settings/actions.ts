'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

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
