import { describe, expect, it } from 'vitest';

import { isOrgId } from './cookie';
import { chooseOrganization, defaultOrganization, type Membership } from './pick';
import { canManageMembers, canWrite, isOrgRole } from './roles';

const ALPHA: Membership = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alpha AE',
  vatNumber: '111222333',
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00Z',
};

const BETA: Membership = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Beta AE',
  vatNumber: '444555666',
  role: 'member',
  joinedAt: '2026-06-01T00:00:00Z',
};

describe('chooseOrganization', () => {
  it('honours the cookie when it names a company the caller belongs to', () => {
    expect(chooseOrganization([ALPHA, BETA], BETA.id)).toBe(BETA);
  });

  it('falls back rather than emptying the screen', () => {
    // A membership that was revoked, a company that was deleted, a hand-edited
    // cookie: all of them have to land somewhere the caller can actually work,
    // and the alternative is an application where every page is blank.
    const stranger = '33333333-3333-3333-3333-333333333333';

    expect(chooseOrganization([ALPHA, BETA], stranger)).toBe(ALPHA);
    expect(chooseOrganization([ALPHA, BETA], 'not-a-uuid')).toBe(ALPHA);
    expect(chooseOrganization([ALPHA, BETA], null)).toBe(ALPHA);
    expect(chooseOrganization([ALPHA, BETA], undefined)).toBe(ALPHA);
  });

  it('is null only when there is nothing to choose from', () => {
    expect(chooseOrganization([], ALPHA.id)).toBeNull();
    expect(defaultOrganization([])).toBeNull();
  });
});

describe('defaultOrganization', () => {
  it('takes the oldest membership, whatever order they arrive in', () => {
    expect(defaultOrganization([BETA, ALPHA])).toBe(ALPHA);
    expect(defaultOrganization([ALPHA, BETA])).toBe(ALPHA);
  });

  it('breaks a tie on the company id, exactly as the policy does', () => {
    // Two memberships created in the same transaction share a timestamp. The
    // resolver in `current_org_id()` orders by (created_at, organization_id),
    // and if this disagreed the header would name one company while the page
    // rendered another.
    const sameDay = { ...BETA, joinedAt: ALPHA.joinedAt };
    expect(defaultOrganization([sameDay, ALPHA])).toBe(ALPHA);
  });
});

describe('isOrgId', () => {
  it('accepts a uuid and nothing else', () => {
    expect(isOrgId(ALPHA.id)).toBe(true);
    expect(isOrgId('11111111-1111-1111-1111-11111111111')).toBe(false);
    expect(isOrgId('')).toBe(false);
    expect(isOrgId(null)).toBe(false);
    expect(isOrgId('../../etc/passwd')).toBe(false);
  });
});

describe('roles', () => {
  it('lets owners and members write, and viewers read', () => {
    expect(canWrite('owner')).toBe(true);
    expect(canWrite('member')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
  });

  it('keeps membership management to owners', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('member')).toBe(false);
    expect(canManageMembers('viewer')).toBe(false);
  });

  it('recognises only the three roles the column allows', () => {
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('admin')).toBe(false);
    expect(isOrgRole(null)).toBe(false);
  });
});
