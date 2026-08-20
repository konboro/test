import { isOrgId } from './cookie';
import type { OrgRole } from './roles';

export interface Membership {
  id: string;
  name: string | null;
  vatNumber: string | null;
  role: OrgRole;
  /** When this person joined the company — the tie-break for "which one". */
  joinedAt: string;
}

/**
 * Which company to land in when nothing else decides it.
 *
 * Must stay identical to the fallback in `current_org_id()` — oldest
 * membership, company id as the tie-break. If the two ever disagree, the header
 * says one company and the rows come from another, which is the worst failure
 * this feature could have.
 */
export function defaultOrganization(orgs: Membership[]): Membership | null {
  if (!orgs.length) return null;

  return (
    [...orgs].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id))[0] ??
    null
  );
}

/**
 * The company a request is acting for, given what the cookie asked for.
 *
 * A cookie is a preference, not a permission: `wanted` is only honoured when it
 * names a company the caller is actually a member of. Anything else — junk, a
 * company they were removed from, one that was deleted — falls back rather than
 * failing, because the alternative is an application where every screen is
 * empty and nothing says why.
 */
export function chooseOrganization(
  orgs: Membership[],
  wanted: string | null | undefined,
): Membership | null {
  if (!orgs.length) return null;

  const chosen = isOrgId(wanted) ? orgs.find((org) => org.id === wanted) : undefined;
  return chosen ?? defaultOrganization(orgs);
}
