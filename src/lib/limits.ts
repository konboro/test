/**
 * Switches that govern how much this product may do on its own.
 */

import { optionalEnv } from '@/lib/env';

/**
 * Whether the internal SMS credit meter governs anything.
 *
 * Credits record what a tenant has pre-paid lefta for. Nobody can buy any yet —
 * selling packs needs a platform Stripe account — so enforcing the meter would
 * block messages the SMS provider itself would happily deliver, which from the
 * panel is indistinguishable from a broken integration. Off is the correct
 * default until packs can be bought.
 *
 * It was once tied to the contact-limit testing hatch, which made that hatch
 * impossible to remove: switching it off would have switched the credit meter ON
 * at the same moment, and with no way to buy credits every SMS would have
 * stopped. Two unrelated decisions sharing one switch is how a safety
 * control ends up load-bearing for something else.
 *
 * While it is off the balance is not merely ignored, it is hidden: a prominent
 * "0 credits, running low" describes a constraint that is not in force, and a
 * number that governs nothing teaches the operator to distrust the ones that do.
 */
export function smsCreditsEnforced(): boolean {
  return optionalEnv('ENFORCE_SMS_CREDITS') === '1';
}

