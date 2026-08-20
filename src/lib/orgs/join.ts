/**
 * Turning the database's refusal into something a person can act on.
 *
 * `accept_invite` raises in English, deliberately — those strings are a
 * protocol between the schema and this file, not user-facing copy. Each one has
 * a different next step for whoever is holding the link: wait for a new
 * invitation, sign in as someone else, or ask why it was already used. A single
 * "could not join" would hide that difference.
 */
export type JoinFailure = 'notFound' | 'used' | 'expired' | 'wrongEmail' | 'failed';

export function joinFailure(message: string | null | undefined): JoinFailure {
  const text = (message ?? '').toLowerCase();

  if (text.includes('different email')) return 'wrongEmail';
  if (text.includes('expired')) return 'expired';
  if (text.includes('already used')) return 'used';
  if (text.includes('not found')) return 'notFound';

  return 'failed';
}
