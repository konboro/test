/**
 * Which company the session is acting for.
 *
 * Kept in its own module with no imports so that the Supabase client can read
 * it without dragging the rest of the org helpers — which import the client —
 * into a cycle.
 *
 * The cookie is a preference, never a permission. It is passed to Postgres as
 * a header and the policy resolves it against the caller's memberships, so the
 * worst a hand-edited cookie can do is put you in one of your own companies.
 */
export const ORG_COOKIE = 'lefta_org';

/** The header the policies read. Lowercase: PostgREST normalises them. */
export const ORG_HEADER = 'x-lefta-org';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape check before the value is sent anywhere.
 *
 * Postgres would reject the junk safely — `requested_org_id()` swallows a bad
 * cast — but a header that cannot possibly be a company id is not worth
 * sending, and this keeps the failure in one obvious place.
 */
export function isOrgId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
