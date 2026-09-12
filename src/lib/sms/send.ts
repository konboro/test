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
 * The GSM-03.38 default alphabet: the 128 characters a message can carry at
 * seven bits each.
 *
 * It is not ASCII, in either direction. It holds £ ¥ § ¡ ¿, the German and
 * Nordic vowels, and the ten Greek capitals that do not look like Latin ones;
 * it lacks the backtick and the curly braces. Treating "non-ASCII" as "needs
 * UCS-2" is therefore wrong in the expensive direction — see `gsmSeptets`.
 */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ' +
    ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
    '¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

/**
 * Reachable only behind the escape byte, so each of these costs two septets.
 *
 * The euro sign lives here, and that detail was costing real money: every
 * English reminder formats its amount as "455,00 €", the old check saw a
 * non-ASCII byte, and the message went out as UCS-2 — 70 characters to work
 * with instead of 160, which turned a 94-character reminder into two billed
 * segments. It is one segment.
 */
const GSM_EXTENDED = new Set('\f^{}\\[~]|€');

/**
 * How many septets the message needs in GSM-03.38, or null if it cannot be
 * written in it at all.
 *
 * Iterating with `for…of` walks code points, so an astral character (an emoji)
 * arrives whole, matches neither table, and correctly forces UCS-2.
 */
function gsmSeptets(message: string): number | null {
  let septets = 0;

  for (const character of message) {
    if (GSM_BASIC.has(character)) septets += 1;
    else if (GSM_EXTENDED.has(character)) septets += 2;
    else return null;
  }

  return septets;
}

/**
 * Whether the message needs UCS-2 rather than GSM-03.38.
 *
 * Every Greek reminder does, and so does most of the world — Cyrillic, Arabic,
 * Hebrew, Thai, the Indic and CJK scripts, and the Latin languages whose
 * diacritics the table omits: Polish, Czech, Romanian, Turkish, Portuguese, and
 * Spanish the moment it needs an "á". What does fit is English, German, Italian,
 * Dutch and the Nordic languages.
 *
 * This drives two separate things — how many segments the message costs, and the
 * `unicodeEnabled` flag Brevo needs — so it has one definition rather than two
 * that can drift apart. Brevo takes the flag at its word and encodes what it is
 * told, which is why a wrong answer here is a doubled bill rather than a wrong
 * number on a screen. Twilio detects the encoding itself and is unaffected on
 * the wire, but the count below is what we show the sender.
 */
export function usesUnicode(message: string): boolean {
  return gsmSeptets(message) === null;
}

/**
 * How many segments the message will be billed as.
 *
 * GSM-7 carries 160 septets alone or 153 when split; UCS-2 carries 70
 * characters alone or 67 when split. Templates are kept short enough to stay
 * one segment either way.
 */
export function segmentCount(message: string): number {
  const septets = gsmSeptets(message);

  if (septets === null) {
    // UCS-2 is billed per UTF-16 code unit, so a surrogate pair counts as two
    // — which is what `length` already reports, unlike a code-point walk.
    return message.length <= 70 ? 1 : Math.ceil(message.length / 67);
  }

  return septets <= 160 ? 1 : Math.ceil(septets / 153);
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
