import { brevoApiKey, sendViaBrevo } from './brevo';
import { sendViaTwilio, twilioCredentials } from './twilio';

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
 * Whether the message needs UCS-2 rather than GSM-03.38.
 *
 * Every Greek reminder does. This drives two separate things — how many segments
 * the message costs, and the `unicodeEnabled` flag Brevo needs — so it has one
 * definition rather than two that can drift apart.
 */
export function usesUnicode(message: string): boolean {
  return /[^\x00-\x7F]/.test(message);
}

/**
 * GSM-03.38 single-segment limit. Greek text falls back to UCS-2 (70 chars),
 * so templates are kept short enough to stay one segment either way.
 */
export function segmentCount(message: string): number {
  const unicode = usesUnicode(message);
  const limit = unicode ? 70 : 160;
  const multipart = unicode ? 67 : 153;
  return message.length <= limit ? 1 : Math.ceil(message.length / multipart);
}

/**
 * Sends one SMS.
 *
 * The provider is Brevo, chosen to start because credits are sold in packs of
 * 100 and never expire — the smallest commitment on the market that can still
 * reach a real Greek handset. Every alternative gates real sending behind either
 * a larger prepayment or a verification queue.
 *
 * Only `dispatch` knows that. Moving to Twilio or a Greek aggregator later means
 * replacing that one function — the rest of the system depends on this module's
 * signature, not on the provider.
 */
/**
 * Which provider a send would go through.
 *
 * Twilio wins when it is configured, Brevo otherwise. That ordering is the
 * migration: with only Brevo credentials present nothing changes, and the day
 * Twilio's are added every subsequent message goes through Twilio without a
 * deploy. Removing them again falls straight back.
 *
 * Deliberately not a `SMS_PROVIDER` switch. A name and a set of credentials can
 * disagree, and the failure — a provider selected but not configured — is a
 * reminder that silently does not send.
 */
export type SmsTransport = 'twilio' | 'brevo';

export function smsTransport(): SmsTransport | null {
  if (twilioCredentials()) return 'twilio';
  if (brevoApiKey()) return 'brevo';
  return null;
}

export async function sendSms({ phone, message }: SmsMessage): Promise<SmsResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: `Unusable phone number: ${phone}` };

  const transport = smsTransport();

  if (!transport) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'No SMS provider is configured' };
    }
    console.info('[sms:dry-run]', { to, segments: segmentCount(message), message });
    return { ok: true, messageId: `dry-run-${Date.now()}` };
  }

  if (transport === 'twilio') {
    const credentials = twilioCredentials();
    // Narrowing only; smsTransport() already established it is there.
    if (credentials) return sendViaTwilio(credentials, to, message);
  }

  const apiKey = brevoApiKey();
  if (apiKey) return sendViaBrevo(apiKey, to, message);

  return { ok: false, error: 'No SMS provider is configured' };
}
