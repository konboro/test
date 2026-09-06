/**
 * Testing escape hatch for the contact limits.
 *
 * Normally a debtor receives at most one contact per calendar day, enforced by a
 * unique index that the engine must claim a row against before sending. That is
 * the product's compliance guarantee and the reason it can be described as an
 * IT provider transmitting reminders rather than a collection operation.
 *
 * While the delivery pipeline is being set up that guarantee also makes it
 * impossible to send the same test message twice, so this flag lifts it — for
 * **manual sends only**. The automated sweep keeps every lock it has: an
 * unbounded cron aimed at real debtors is a different kind of risk from a person
 * pressing a button, and nothing about setting up email requires loosening it.
 *
 * With the flag on, a manual reminder sends without claiming a contact row at
 * all. Nothing is written to `dunning_contacts`, so ladder bookkeeping stays
 * exactly as it was; the messages themselves are still recorded in
 * `communications_log` with a null contact_id.
 *
 * Set `UNSAFE_DISABLE_CONTACT_LIMITS=1` to enable. Deleting the variable
 * restores the guarantee — there is no migration to undo, and no state left
 * behind. The name is deliberately alarming: this must not survive into
 * day-to-day operation, and the invoice list shows a banner while it is on so it
 * cannot be left running unnoticed.
 */

import { optionalEnv } from '@/lib/env';

export function contactLimitsDisabled(): boolean {
  return optionalEnv('UNSAFE_DISABLE_CONTACT_LIMITS') === '1';
}

/**
 * Whether the internal SMS credit meter governs anything.
 *
 * Credits record what a tenant has pre-paid lefta for. Nobody can buy any yet —
 * selling packs needs a platform Stripe account — so enforcing the meter would
 * block messages the SMS provider itself would happily deliver, which from the
 * panel is indistinguishable from a broken integration. Off is the correct
 * default until packs can be bought.
 *
 * It used to read `!contactLimitsDisabled()`, which tied it to the testing
 * escape hatch. That coupling made the hatch impossible to remove: switching it
 * off to restore the daily contact guarantee would have switched the credit
 * meter ON at the same moment, and with no way to buy credits every SMS would
 * have stopped. Two unrelated decisions sharing one switch is how a safety
 * control ends up load-bearing for something else.
 *
 * While it is off the balance is not merely ignored, it is hidden: a prominent
 * "0 credits, running low" describes a constraint that is not in force, and a
 * number that governs nothing teaches the operator to distrust the ones that do.
 */
export function smsCreditsEnforced(): boolean {
  return optionalEnv('ENFORCE_SMS_CREDITS') === '1';
}

