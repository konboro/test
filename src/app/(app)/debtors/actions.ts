'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { normaliseSnoozeNote, resolveSnooze } from '@/lib/dunning/snooze';
import { athensDate } from '@/lib/money';
import { normalisePhone } from '@/lib/sms/send';
import { writableOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { saveFailed } from '@/lib/errors';
import { formError, getDictionary } from '@/lib/i18n';

export interface DebtorFormState {
  error?: string;
  success?: string;
}

const debtorSchema = z
  .object({
    name: z.string().trim().min(1, 'nameRequired').max(200),
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
        message: 'invalidEmail',
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
    // Empty means automatic, and is stored as null rather than as a language.
    // A stored 'el' would be indistinguishable from a deliberate choice and
    // would stop tracking the phone number if it later changed.
    locale: z
      .enum(['el', 'en'])
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .refine((d) => d.phone === null || normalisePhone(d.phone) !== null, {
    message: 'invalidPhone',
    path: ['phone'],
  });

function read(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    vat_number: String(formData.get('vat_number') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    locale: formData.get('locale') === 'el' || formData.get('locale') === 'en'
      ? formData.get('locale')
      : null,
  };
}

export async function createDebtor(
  _prev: DebtorFormState,
  formData: FormData,
): Promise<DebtorFormState> {
  const t = await getDictionary();

  const parsed = debtorSchema.safeParse(read(formData));
  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const supabase = await createClient();
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : null;

  // RLS still enforces ownership; user_id is set explicitly because the policy
  // checks it rather than defaulting it.
  const { error } = await supabase.from('debtors').insert({
    user_id: org.id,
    ...parsed.data,
    phone,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: t.forms.errors.vatTaken };
    }
    return { error: saveFailed(t, 'debtors', error) };
  }

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  return { success: t.forms.success.debtorAdded };
}

export async function updateDebtor(
  _prev: DebtorFormState,
  formData: FormData,
): Promise<DebtorFormState> {
  const t = await getDictionary();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: t.forms.errors.missingDebtorId };

  const parsed = debtorSchema.safeParse(read(formData));
  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  // A write that changes nothing must not report success.
  //
  // Row-level security refuses a viewer's update by matching no rows, and
  // PostgREST answers that with 204 and no error — so this returned "saved"
  // having saved nothing, and the operator went away believing the opposite of
  // what happened. Asking for the affected row turns a silent refusal into an
  // answer, whether the cause is permission or an id that was never theirs.
  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const supabase = await createClient();
  const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : null;

  const { data: changed, error } = await supabase
    .from('debtors')
    .update({ ...parsed.data, phone })
    .eq('id', id)
    .select('id');

  if (error) return { error: saveFailed(t, 'debtors', error) };

  // No error and no row is the refusal case: the policy declined it, or the id
  // belongs to another company. Either way nothing was written, so nothing is
  // reported as written.
  if (!changed?.length) return { error: t.forms.errors.debtorNotFound };

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  return { success: t.forms.success.debtorUpdated };
}

/** Pauses or resumes automated reminders for one debtor. */
/**
 * Deletes one customer, and everything the schema hangs off them.
 *
 * The cascade is wide and mostly invisible from the page the button sits on:
 * their invoices go, and with each invoice its payment attempts and link
 * activity; their entire message history goes too, because
 * `communications_log.debtor_id` cascades. That last one is the record of what
 * was said to a real person on the tenant's behalf, so the dialog states the
 * count before anyone presses it.
 *
 * Ownership is checked here rather than left to RLS, because the delete runs
 * under the service role. `confirm` is required so that a delete is never one
 * stray request away.
 */
export async function deleteDebtor(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const t = await getDictionary();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: t.forms.errors.unauthorized };
  if (formData.get('confirm') !== 'yes') return { error: t.forms.errors.unauthorized };

  const org = await writableOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const admin = createAdminClient();

  const { data: debtor } = await admin
    .from('debtors')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!debtor || debtor.user_id !== org.id) return { error: t.forms.errors.unauthorized };

  const { error } = await admin.from('debtors').delete().eq('id', id).eq('user_id', org.id);
  if (error) return { error: saveFailed(t, 'debtors', error) };

  revalidatePath('/debtors');
  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
  revalidatePath('/logs');

  return { ok: true };
}

export async function toggleMute(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const muted = String(formData.get('muted') ?? '') === 'true';
  if (!id) return;

  // Muting decides whether a customer is chased at all, so it is a write and
  // needs write access — not the read-role check it had, which let the policy
  // refuse the row silently instead.
  const org = await writableOrganization();
  if (!org) return;

  const supabase = await createClient();
  await supabase.from('debtors').update({ muted: !muted }).eq('id', id);

  revalidatePath('/debtors');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
}

/**
 * Holds every reminder for this customer until a date — the "I'll pay on the
 * 15th" case.
 *
 * Written through the session client rather than the service role: the
 * migration grants exactly this column to `authenticated`, and RLS decides
 * whose customer it is, which is the check that matters.
 *
 * The form sends either a preset number of days or a date typed by hand, and
 * both are validated here rather than trusted — an unbounded pause is a mute
 * wearing a date, and this action is reachable with any payload.
 */
export async function snoozeDebtor(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const org = await writableOrganization();
  if (!org) return;

  const today = athensDate();

  // "Resume now" is the same action with nothing to set, so lifting a snooze
  // needs no second code path that could disagree with this one. Which of the
  // posted fields decides is `resolveSnooze`, and it is tested there.
  const resolved = resolveSnooze(
    {
      resume: formData.get('resume') !== null,
      days: String(formData.get('days') ?? ''),
      until: String(formData.get('until') ?? ''),
    },
    today,
  );

  // The reason travels with the date and dies with it: a note explaining a
  // pause that is no longer running is just a stale claim about a customer.
  const note = resolved ? normaliseSnoozeNote(String(formData.get('note') ?? '')) : null;

  const supabase = await createClient();
  await supabase
    .from('debtors')
    .update({ snoozed_until: resolved, snooze_note: note })
    .eq('id', id);

  revalidatePath('/debtors');
  revalidatePath(`/debtors/${id}`);
  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/statistics');
}