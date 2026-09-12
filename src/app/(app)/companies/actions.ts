'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { DeleteState } from '@/components/delete-button';
import { formError, getDictionary } from '@/lib/i18n';
import { listOrganizations } from '@/lib/orgs/active';
import { ORG_COOKIE, isOrgId } from '@/lib/orgs/cookie';
import { safeNextPath } from '@/lib/redirects';
import { createClient } from '@/lib/supabase/server';

export interface CompanyState {
  error?: string;
}

/** A year: long enough that an accountant stays where they left off. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function rememberCompany(id: string) {
  (await cookies()).set(ORG_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Switch which company the session is acting for.
 *
 * The membership is checked here even though the database checks it again: the
 * cookie is also read by the service-role paths, which have no policy to fall
 * back on, and a cookie is worth exactly as much as the last thing that
 * verified it.
 */
export async function switchOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const next = safeNextPath(formData.get('next'));

  if (!isOrgId(id)) redirect(next);

  const orgs = await listOrganizations();
  if (!orgs.some((org) => org.id === id)) redirect(next);

  await rememberCompany(id);

  // Everything on screen belongs to the company that just changed.
  revalidatePath('/', 'layout');
  redirect(next);
}

const companySchema = z.object({
  company_name: z.string().trim().min(1, 'nameRequired').max(200),
  vat_number: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Add a company to this login.
 *
 * Through the `create_organization` function rather than an insert: `users` has
 * no insert grant for `authenticated` and should not — the row it would create
 * carries the credential columns of a tenant.
 */
export async function createOrganization(
  _prev: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const t = await getDictionary();

  const parsed = companySchema.safeParse({
    company_name: formData.get('company_name'),
    vat_number: formData.get('vat_number'),
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    p_company_name: parsed.data.company_name,
    p_vat_number: parsed.data.vat_number,
  });

  if (error) return { error: error.message };
  if (!data) return { error: t.forms.errors.unauthorized };

  await rememberCompany(data);
  revalidatePath('/', 'layout');

  // Into settings rather than the dashboard: a company that was created a
  // second ago has no invoices to show, and the thing standing between it and
  // its first reminder is a myDATA or Elorus connection.
  redirect('/settings');
}

/**
 * Delete a company and everything it owns.
 *
 * Only reachable from the confirmation dialog, which is what sets `confirm` —
 * this cascades through every invoice, every debtor and the whole
 * correspondence record, and must not be one stray request away.
 */
export async function deleteOrganization(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const t = await getDictionary();
  const id = String(formData.get('id') ?? '');

  if (!isOrgId(id) || formData.get('confirm') !== 'yes') {
    return { error: t.forms.errors.unauthorized };
  }

  const supabase = await createClient();
  // Owner-only: the function checks the caller against the membership itself.
  const { error } = await supabase.rpc('delete_organization', { p_org: id });
  if (error) return { error: error.message };

  // Whatever the cookie said, that company may no longer exist. Clearing it
  // sends the resolver back to its fallback — the caller's oldest company —
  // rather than to a screen with nothing on it.
  (await cookies()).delete(ORG_COOKIE);

  revalidatePath('/', 'layout');
  redirect('/companies');
}
