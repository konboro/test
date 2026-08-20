import type { Dictionary } from '@/lib/i18n';

/**
 * What to tell someone when our own storage refuses.
 *
 * A Postgres error describes our defect in our vocabulary. "there is no unique
 * or exclusion constraint matching the ON CONFLICT specification" is a true
 * sentence and a useless one: it named a database feature to a person holding a
 * spreadsheet, in English, appended to a Greek sentence. It went on screen for
 * days because returning `error.message` is the shortest thing to type.
 *
 * So the raw error goes to the log, where it is the only thing that helps, and
 * the reader gets a sentence in their own language that says what happened to
 * their work and what to do next.
 *
 * This is deliberately not the rule for third parties. When a bank or a card
 * processor refuses, their words are the only true account of why, and guessing
 * at a friendlier cause sends the operator to fix something that was never
 * broken. Ours are internal; theirs are the answer.
 *
 * `where` is a tag for the log, never shown.
 */
export function saveFailed(t: Dictionary, where: string, error: unknown): string {
  console.error(`[${where}]`, error);
  return t.forms.errors.saveFailed;
}

/** The same, for a read that failed before anything was changed. */
export function loadFailed(t: Dictionary, where: string, error: unknown): string {
  console.error(`[${where}]`, error);
  return t.forms.errors.loadFailed;
}
