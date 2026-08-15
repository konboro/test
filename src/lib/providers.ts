/**
 * Which delivery and payment providers are actually usable right now.
 *
 * This is the single place that answers "can anything real happen on this
 * channel", and it exists because the answer has to be known *before* the
 * dunning engine claims a contact row. Claiming that row is irreversible: the
 * unique index on (invoice_id, step) means a step fires at most once per invoice
 * ever. If the engine claimed a contact and only then discovered that Resend was
 * never configured, the reminder would be recorded as `failed` and that rung of
 * the ladder would be silently burned for good — the invoice would never be
 * chased at that step again, even after the key was added.
 *
 * So an unconfigured provider must make a channel *unavailable*, not *failing*.
 *
 * Outside production a missing key is simulated by the senders (they log the
 * message and report success), which keeps the whole workflow exercisable with
 * no third-party accounts. There the channel counts as available. In production
 * a missing key means the message genuinely cannot be delivered.
 */

import { optionalEnv } from '@/lib/env';

export type Channel = 'email' | 'sms';

/** Senders fall back to dry-run outside production; see lib/email/send.ts. */
function dryRunMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function emailAvailable(): boolean {
  return Boolean(optionalEnv('RESEND_API_KEY')) || dryRunMode();
}

export function smsAvailable(): boolean {
  return Boolean(optionalEnv('BREVO_API_KEY')) || dryRunMode();
}

/**
 * Card payments have no dry-run equivalent — a Checkout session cannot be
 * simulated into existence — so this is false without a key in every
 * environment. Callers degrade the payment page rather than offering a button
 * that 500s.
 */
export function paymentsAvailable(): boolean {
  return Boolean(optionalEnv('STRIPE_SECRET_KEY'));
}

export function channelAvailable(channel: Channel): boolean {
  return channel === 'email' ? emailAvailable() : smsAvailable();
}

export interface ProviderStatus {
  email: boolean;
  sms: boolean;
  payments: boolean;
}

/** Reported by the cron endpoint so a dry run explains its own outcome. */
export function providerStatus(): ProviderStatus {
  return {
    email: emailAvailable(),
    sms: smsAvailable(),
    payments: paymentsAvailable(),
  };
}
