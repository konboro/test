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
export async function sendSms({ phone, message }: SmsMessage): Promise<SmsResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: `Unusable phone number: ${phone}` };

  const apiKey = optionalEnv('BREVO_API_KEY');

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'BREVO_API_KEY is not configured' };
    }
    console.info('[sms:dry-run]', { to, segments: segmentCount(message), message });
    return { ok: true, messageId: `dry-run-${Date.now()}` };
  }

  return dispatch(apiKey, to, message);
}

/**
 * Taken from Brevo's own Go SDK, which is generated from their OpenAPI spec.
 * Their published reference shows `/transactionalSMS/send` for the asynchronous
 * variant; if a live send ever returns 404, this constant is the thing to change.
 */
const BREVO_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/sms';

async function dispatch(apiKey: string, to: string, message: string): Promise<SmsResult> {
  // Brevo caps the sender at 11 alphanumeric characters, and Greek operators
  // block generic names (INFO, SMS, NOTICE), so this has to stay a short brand.
  const sender = optionalEnv('SMS_SENDER_ID') ?? 'lefta';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(BREVO_SMS_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender,
        // Brevo accepts 6–15 digits with an optional leading '+', so the E.164
        // form `normalisePhone` produces goes through unchanged.
        recipient: to,
        content: message,
        // Reminders are informational, not marketing. The distinction is not
        // cosmetic: transactional messages are exempt from the consent and
        // quiet-hours rules that govern promotional SMS.
        type: 'transactional',
        // Brevo defaults this to false, which would mangle every Greek reminder
        // we send. It has to be derived from the content, not assumed.
        unicodeEnabled: usesUnicode(message),
      }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as
      | { messageId?: number | string; message?: string; code?: string }
      | null;

    if (!response.ok) {
      // Brevo returns {code, message} on rejection. Carry the message through:
      // an unusable sender or an empty credit balance both land here, and the
      // difference matters to whoever reads the log.
      const detail = body?.message;
      return {
        ok: false,
        error: detail
          ? `SMS provider responded ${response.status}: ${detail}`
          : `SMS provider responded ${response.status}`,
      };
    }

    return {
      ok: true,
      // messageId comes back as a number; the rest of the system stores a string.
      messageId: body?.messageId === undefined ? undefined : String(body.messageId),
    };
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return { ok: false, error: 'SMS request timed out' };
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}
