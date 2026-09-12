/**
 * Escapes text on its way into an HTML email body.
 *
 * The reminder and payment mails already do this; the report notification did
 * not, and it is the one mail whose contents a stranger writes. A debtor holding
 * a payment link — or anyone the reminder was forwarded to — fills in a free-text
 * message, and it was interpolated verbatim into a mail sent from lefta's own
 * verified sending domain to the creditor's inbox. That is an authentic-looking
 * message carrying somebody else's markup: a styled button pointing anywhere,
 * different bank details, or a block that hides the real report underneath.
 *
 * Kept in one place so the next builder does not have to remember. The two
 * existing private copies are left where they are for now; consolidating them
 * would touch files another session is editing.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
