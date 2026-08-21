'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { saveFailed } from '@/lib/errors';
import { getDictionary } from '@/lib/i18n';
import { generateRentCharges } from '@/lib/leases/generate';
import { athensDate } from '@/lib/money';
import { writableOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

export interface LeaseState {
  error?: string;
  success?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  property: z.string().trim().min(1, 'propertyRequired').max(200),
  debtor_id: z.string().uuid('tenantRequired'),
  amount: z.coerce.number().positive('amountPositive'),
  due_day: z.coerce.number().int().min(1, 'dueDayRange').max(31, 'dueDayRange'),
  starts_on: z.string().regex(DATE, 'invalidDate'),
  ends_on: z
    .string()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || DATE.test(value), { message: 'invalidDate' }),
  generate_from: z.string().regex(DATE, 'invalidDate'),
});

function message(t: Awaited<ReturnType<typeof getDictionary>>, key: string | undefined): string {
  const errors = t.leases.errors as Record<string, string>;
  return (key && errors[key]) || t.forms.errors.invalidData;
}

/**
 * Records a lease. Nothing is charged here.
 *
 * The charge for a month is created by the daily run, from this row — so saving
 * a lease is a statement about the future, not an invoice. That separation is
 * what makes the screen safe to use: a landlord correcting a typo is editing an
 * agreement, not cancelling money somebody already owes.
 */
export async function createLease(_prev: LeaseState, formData: FormData): Promise<LeaseState> {
  const t = await getDictionary();

  const parsed = schema.safeParse({
    property: formData.get('property'),
    debtor_id: formData.get('debtor_id'),
    amount: formData.get('amount'),
    due_day: formData.get('due_day'),
    starts_on: formData.get('starts_on'),
    ends_on: formData.get('ends_on'),
    generate_from: formData.get('generate_from'),
  });

  if (!parsed.success) {
    return { error: message(t, parsed.error.issues[0]?.message) };
  }

  const data = parsed.data;

  if (data.ends_on && data.ends_on < data.starts_on) {
    return { error: t.leases.errors.endBeforeStart };
  }

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const supabase = await createClient();

  // `user_id` is set explicitly because the policy checks it rather than
  // defaulting it — the same contract every other insert in the product follows.
  const { error } = await supabase.from('leases').insert({
    user_id: org.id,
    debtor_id: data.debtor_id,
    property: data.property,
    amount_cents: Math.round(data.amount * 100),
    due_day: data.due_day,
    starts_on: data.starts_on,
    ends_on: data.ends_on,
    generate_from: data.generate_from,
  });

  if (error) return { error: saveFailed(t, 'leases:create', error) };

  // Bill the month straight away if it is already owed, rather than leaving the
  // landlord to wonder overnight whether anything happened. The daily run would
  // do it tomorrow; doing it now is the difference between a feature that looks
  // broken on the first try and one that does not.
  //
  // Failure here is not the operator’s problem: the lease is saved, and the
  // next run picks the month up on its own.
  try {
    await generateRentCharges({ userId: org.id });
  } catch (cause) {
    console.error('[leases] first charge', String(cause));
  }

  revalidatePath('/leases');
  revalidatePath('/dashboard');

  return { success: t.leases.created };
}

/**
 * Stops or restarts the monthly charge for one lease.
 *
 * Pausing leaves every charge already created exactly where it is, including
 * the unpaid ones. A landlord pausing a lease is saying "stop billing this
 * flat", not "forgive what is owed", and quietly cancelling debts would be the
 * more surprising of the two readings by a long way.
 */
export async function toggleLease(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const active = String(formData.get('active') ?? '') === 'true';

  const org = await writableOrganization();
  if (!org) return;

  const supabase = await createClient();
  await supabase.from('leases').update({ active: !active }).eq('id', id);

  revalidatePath('/leases');
}

/** The month a new lease should start billing from, unless the landlord moves it. */
export async function defaultGenerateFrom(): Promise<string> {
  return `${athensDate().slice(0, 7)}-01`;
}
