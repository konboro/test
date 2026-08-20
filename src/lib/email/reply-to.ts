/**
 * Where a debtor's reply lands.
 *
 * Reminders are sent from the platform domain, because that is the domain with
 * SPF and DKIM behind it; signing as each creditor's own domain would mean
 * verifying every one of them. What the recipient reads is the display name,
 * and the only thing that makes "Reply" work is this header.
 *
 * So a missing Reply-To is not a cosmetic gap. Without it the debtor answers
 * noreply@ on our domain and their reply is simply lost — no bounce, no error,
 * and the creditor never learns that someone tried to arrange payment.
 *
 * The account address is the right fallback: it is verified at sign-up and
 * belongs to the person who created the account. It is a worse choice than a
 * deliberate one, and a far better choice than nothing.
 */
export function replyToFor(tenant: {
  reply_to_email?: string | null;
  email?: string | null;
}): string | undefined {
  const chosen = tenant.reply_to_email?.trim();
  if (chosen) return chosen;

  const account = tenant.email?.trim();
  return account || undefined;
}
