import { optionalEnv } from '@/lib/env';

import { usesUnicode, type SmsResult } from './send';

/**
 * Sending through Brevo.
 *
 * Unchanged from when it was the only transport — lifted out so that choosing
 * between providers is a decision in one place rather than a branch inside the
 * thing doing the sending.
 */
export function brevoApiKey(): string | null {
  return optionalEnv('BREVO_API_KEY') ?? null;
}

/**
 * Taken from Brevo's own Go SDK, which is generated from their OpenAPI spec.
 * Their published reference shows `/transactionalSMS/send` for the asynchronous
 * variant; if a live send ever returns 404, this constant is the thing to change.
 */
const BREVO_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/sms';

export async function sendViaBrevo(apiKey: string, to: string, message: string): Promise<SmsResult> {
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
