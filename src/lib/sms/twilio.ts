import { optionalEnv } from '@/lib/env';

import type { SmsResult } from './send';

/**
 * Sending through Twilio.
 *
 * Adapted from the transport written on `feat/sms-twilio`, which was branched
 * before Brevo existed and rewrote a file that has changed underneath it 169
 * commits since. The API details there were right and are kept; what is not
 * kept is the wholesale replacement of a module that has learned things since —
 * the segment counting, the phone normalisation and the dry-run behaviour all
 * stay where they are and are shared by both transports.
 */

const ENDPOINT = 'https://api.twilio.com/2010-04-01/Accounts';

/** Ten hours, which is both Twilio's default and its ceiling for this field. */
const VALIDITY_SECONDS = '36000';

const TIMEOUT_MS = 15_000;

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export function twilioCredentials(): TwilioCredentials | null {
  const accountSid = optionalEnv('TWILIO_ACCOUNT_SID');
  const authToken = optionalEnv('TWILIO_AUTH_TOKEN');

  return accountSid && authToken ? { accountSid, authToken } : null;
}

/**
 * Who the message comes from.
 *
 * A Messaging Service wins when one is configured. It is what Twilio expects
 * for anything beyond a single number — it owns the sender pool, the
 * per-country sender selection and the compliance registration, and moving
 * those decisions out of this code is the point of it existing.
 *
 * Otherwise a plain sender, which may be a number or an alphanumeric ID. Greek
 * operators block generic names — INFO, SMS, NOTICE — so it has to stay a brand
 * the recipient can place. Note that an alphanumeric sender cannot receive a
 * reply: a debtor answering the SMS reaches nobody, which is why the reminder
 * carries a payment link rather than an invitation to reply.
 */
function senderFields(): Record<string, string> {
  const service = optionalEnv('TWILIO_MESSAGING_SERVICE_SID');
  if (service) return { MessagingServiceSid: service };

  return { From: optionalEnv('TWILIO_FROM') ?? optionalEnv('SMS_SENDER_ID') ?? 'lefta' };
}

export async function sendViaTwilio(
  { accountSid, authToken }: TwilioCredentials,
  to: string,
  message: string,
): Promise<SmsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${ENDPOINT}/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          // btoa rather than Buffer: nothing else here ties the module to Node.
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          ...senderFields(),
          Body: message,
          // Reminders are worthless once stale. Better to expire in the queue
          // than to arrive days late looking like a fresh demand.
          ValidityPeriod: VALIDITY_SECONDS,
        }),
        signal: controller.signal,
      },
    );

    const body = (await response.json().catch(() => null)) as
      | { sid?: string; code?: number; message?: string; error_message?: string }
      | null;

    if (!response.ok) {
      // A rejected request carries {code, message, more_info}; `error_message`
      // is the field used once a message was accepted and failed later.
      const detail = body?.message ?? body?.error_message;
      return {
        ok: false,
        error: detail
          ? `SMS provider responded ${response.status}: ${detail}`
          : `SMS provider responded ${response.status}`,
      };
    }

    // Twilio needs no encoding flag: it detects GSM-7 against UCS-2 itself, so
    // Greek goes through without the switch Brevo required.
    return { ok: true, messageId: body?.sid };
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return { ok: false, error: 'SMS request timed out' };
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}
