/**
 * What a member of a company may do.
 *
 * The database is the authority — every write policy carries
 * `current_org_writes()`, and membership management is behind security-definer
 * functions that check the caller themselves. These helpers exist so the UI can
 * agree with it: a button that submits a form the database will refuse is worse
 * than no button.
 */

import type { MemberRole } from '@/types/database';

/** Named for the app's vocabulary; the same three values the column allows. */
export type OrgRole = MemberRole;

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'member', 'viewer'] as const;

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

/** Everything operational: sending, editing, importing, settling. */
export function canWrite(role: OrgRole): boolean {
  return role === 'owner' || role === 'member';
}

/** Members, invitations, and deleting the company itself. */
export function canManageMembers(role: OrgRole): boolean {
  return role === 'owner';
}
