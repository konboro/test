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
 * The provider is Yuboto (Greek aggregator, https://services.yuboto.com). The
 * transport below is a real HTTP call against their Omni API; swapping in Twilio
 * means replacing only `dispatch` — the rest of the system depends on this
 * module's signature, not on the provider.
 */
export async function sendSms({ phone, message }: SmsMessage): Promise<SmsResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: `Unusable phone number: ${phone}` };

  const apiKey = optionalEnv('YUBOTO_API_KEY');

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'YUBOTO_API_KEY is not configured' };
    }
    console.info('[sms:dry-run]', { to, segments: segmentCount(message), message });
    return { ok: true, messageId: `dry-run-${Date.now()}` };
  }

  return dispatch(apiKey, to, message);
}

async function dispatch(apiKey: string, to: string, message: string): Promise<SmsResult> {
  const sender = optionalEnv('SMS_SENDER_ID') ?? 'lefta';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://services.yuboto.com/omni/v1/Send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phonenumbers: [to],
        channel: 'sms',
        sms: {
          sender,
          text: message,
          // Reminders are worthless once stale; expire rather than deliver late.
          validity: 1440,
          typesms: 'sms',
        },
      }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as
      | { ErrorCode?: number; ErrorMessage?: string; Message?: { id?: string }[] }
      | null;

    if (!response.ok) {
      return { ok: false, error: `SMS provider responded ${response.status}` };
    }

    if (body?.ErrorCode && body.ErrorCode !== 0) {
      return { ok: false, error: body.ErrorMessage ?? `Provider error ${body.ErrorCode}` };
    }

    return { ok: true, messageId: body?.Message?.[0]?.id };
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return { ok: false, error: 'SMS request timed out' };
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}
