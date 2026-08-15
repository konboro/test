import { optionalEnv } from '@/lib/env';

export interface SmsMessage {
  phone: string;
  message: string;
}

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Normalises a Greek number to E.164.
 *
 * Accepts `69…`, `0030…`, `+3069…` and spaced variants. Returns null when the
 * input cannot be trusted — better to skip the SMS than to bill a credit for a
 * message that will never arrive.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = `+${digits.slice(1).replace(/\D/g, '')}`;
  else digits = digits.replace(/\D/g, '');

  if (digits.startsWith('+')) return digits.length >= 11 ? digits : null;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('30') && digits.length === 12) return `+${digits}`;
  // Bare Greek mobile: 10 digits starting 69.
  if (digits.length === 10 && digits.startsWith('69')) return `+30${digits}`;

  return null;
}

/**
 * GSM-03.38 single-segment limit. Greek text falls back to UCS-2 (70 chars),
 * so templates are kept short enough to stay one segment either way.
 */
export function segmentCount(message: string): number {
  const isUnicode = /[^\x00-\x7F]/.test(message);
  const limit = isUnicode ? 70 : 160;
  const multipart = isUnicode ? 67 : 153;
  return message.length <= limit ? 1 : Math.ceil(message.length / multipart);
}

/**
 * Sends one SMS.
 *
 * The provider is Twilio. Greece is an alphanumeric-sender-only market there —
 * long and short codes are not supported — which means no number to buy and no
 * sender-ID pre-registration to wait on. That is the whole reason it is the
 * provider we can switch on the same day. The trade is price: Twilio runs about
 * double a Greek aggregator per message, and Greek text is UCS-2, so a reminder
 * over 70 characters costs two segments.
 *
 * Only `dispatch` knows any of that. Moving to Yuboto or Apifon later means
 * replacing that one function — the rest of the system depends on this module's
 * signature, not on the provider.
 */
export async function sendSms({ phone, message }: SmsMessage): Promise<SmsResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: `Unusable phone number: ${phone}` };

  const accountSid = optionalEnv('TWILIO_ACCOUNT_SID');
  const authToken = optionalEnv('TWILIO_AUTH_TOKEN');

  if (!accountSid || !authToken) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not configured' };
    }
    console.info('[sms:dry-run]', { to, segments: segmentCount(message), message });
    return { ok: true, messageId: `dry-run-${Date.now()}` };
  }

  return dispatch({ accountSid, authToken }, to, message);
}

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

async function dispatch(
  { accountSid, authToken }: TwilioCredentials,
  to: string,
  message: string,
): Promise<SmsResult> {
  // Greek operators block generic sender names (INFO, SMS, NOTICE), so this has
  // to stay a brand the recipient can place.
  const sender = optionalEnv('SMS_SENDER_ID') ?? 'lefta';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          // btoa, not Buffer: nothing else here ties the module to the Node runtime.
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: sender,
          Body: message,
          // Reminders are worthless once stale; expire in the queue rather than
          // land days late. 36000 s (10 h) is Twilio's ceiling for this.
          ValidityPeriod: '36000',
        }),
        signal: controller.signal,
      },
    );

    const body = (await response.json().catch(() => null)) as
      | { sid?: string; code?: number; message?: string; error_message?: string }
      | null;

    if (!response.ok) {
      // Rejected requests carry {code, message, more_info}. `error_message` is
      // the field used once a message has been accepted and failed later.
      const detail = body?.message ?? body?.error_message;
      return {
        ok: false,
        error: detail
          ? `SMS provider responded ${response.status}: ${detail}`
          : `SMS provider responded ${response.status}`,
      };
    }

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
