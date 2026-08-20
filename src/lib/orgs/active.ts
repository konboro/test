import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { ORG_COOKIE } from './cookie';
import { chooseOrganization, defaultOrganization, type Membership } from './pick';
import { canWrite, isOrgRole, type OrgRole } from './roles';

export { defaultOrganization };
export type { Membership };

/**
 * Every company the signed-in person may act for.
 *
 * Through a security-definer function rather than a select, because the policy
 * on `users` shows exactly one company — the active one — which is the entire
 * point of it, and a switcher has to list the others.
 *
 * `cache` is per request: the layout, the page and any action in the same
 * request share one round-trip.
 */
export const listOrganizations = cache(async (): Promise<Membership[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_organizations');

  return (data ?? [])
    .filter((row) => isOrgRole(row.role))
    .map((row) => ({
      id: row.organization_id,
      name: row.company_name,
      vatNumber: row.vat_number,
      role: row.role as OrgRole,
      joinedAt: row.joined_at,
    }));
});

/** The company this request is acting for, or null when there is not one. */
export const activeOrganization = cache(async (): Promise<Membership | null> => {
  const orgs = await listOrganizations();
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;

  // A cookie naming a company the caller has left, or one that was deleted,
  // resolves the same way the database resolves it: their oldest company.
  return chooseOrganization(orgs, wanted);
});

/**
 * The company, or off to create one.
 *
 * Server code takes the tenant from here and never from `user.id`. Those were
 * the same value for the whole life of the product and are not any more: the
 * auth user is who you are, the company is who you are acting for.
 *
 * The membership behind it is verified — the list comes from the database, not
 * from the cookie — so this id is safe to hand to the service-role client,
 * which has no policy to fall back on.
 */
export async function requireOrganization(): Promise<Membership> {
  const org = await activeOrganization();
  if (!org) redirect('/companies/new');
  return org;
}

/**
 * The company this request may change, or null.
 *
 * For route handlers, which must answer with a status code rather than a
 * redirect, and for the paths that write with the service role — where the
 * policy that would otherwise refuse a viewer is not in play at all, so the
 * role has to be checked here.
 */
export async function writableOrganization(): Promise<Membership | null> {
  const org = await activeOrganization();
  return org && canWrite(org.role) ? org : null;
}
