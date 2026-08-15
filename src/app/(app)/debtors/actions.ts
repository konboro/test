'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { normalisePhone } from '@/lib/sms/send';
import { createClient } from '@/lib/supabase/server';

export interface DebtorFormState {
  error?: string;
  success?: string;
}

const debtorSchema = z
  .object({
    name: z.string().trim().min(1, 'Η επωνυμία είναι υποχρεωτική.').max(200),
    vat_number: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((v) => (v ? v : null)),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.string().email().safeParse(v).success, {
        message: 'Μη έγκυρο email.',
      }),
    phone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .transform((v) => (v ? v : null)),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((d) => d.phone === null || normalisePhone(d.phone) !== null, {
    message: 'Μη έγκυρος αριθμός τηλεφώνου. Χρησιμοποιήστε μορφή +30 69… ',
    path: ['phone'],
  });

function read(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    vat_number: String(formData.get('vat_number') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}

export async function createDebtor(
  _prev: DebtorFormState,
  formData: FormData,
): Promise<DebtorFormState> {
  const parsed = debtorSchema.safeParse(read(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Μη εξουσιοδοτημένη ενέργεια.' };

  const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : null;

  // RLS still enforces ownership; user_id is set explicitly because the policy
  // checks it rather than defaulting it.
  const { error } = await supabase.from('debtors').insert({
    user_id: user.id,
    ...parsed.data,
    phone,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: 'Υπάρχει ήδη πελάτης με αυτό το ΑΦΜ.' };
    }
    return { error: error.message };
  }

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
  return { success: 'Ο πελάτης προστέθηκε.' };
}

export async function updateDebtor(
  _prev: DebtorFormState,
  formData: FormData,
): Promise<DebtorFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Λείπει το αναγνωριστικό πελάτη.' };

  const parsed = debtorSchema.safeParse(read(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };

  const supabase = await createClient();
  const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : null;

  const { error } = await supabase
    .from('debtors')
    .update({ ...parsed.data, phone })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
  return { success: 'Τα στοιχεία ενημερώθηκαν.' };
}

/** Pauses or resumes automated reminders for one debtor. */
export async function toggleMute(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const muted = String(formData.get('muted') ?? '') === 'true';
  if (!id) return;

  const supabase = await createClient();
  await supabase.from('debtors').update({ muted: !muted }).eq('id', id);

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
}
