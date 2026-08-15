import { Resend } from 'resend';

import { optionalEnv, requireEnv } from '@/lib/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /**
   * The creditor's name, shown as the sender.
   *
   * The address stays on the platform domain — that is the one with SPF and
   * DKIM, and signing as the creditor's own domain would require verifying each
   * of theirs. The display name is what the recipient actually reads, so a
   * reminder arrives from "Penny IKE" rather than from an unfamiliar platform,
   * while the envelope stays aligned and deliverable.
   */
  fromName?: string;
}

/**
 * Builds the From header.
 *
 * `EMAIL_FROM` may be a bare address (`noreply@lefta.app`) or already carry a
 * display name (`lefta.app <noreply@lefta.app>`); either is accepted, and a
 * per-message name overrides whatever it holds.
 *
 * The name is stripped of quotes, backslashes and newlines before use. A tenant
 * chooses their own company name, and an unescaped one would otherwise let them
 * inject header content.
 */
export function fromHeader(configured: string | undefined, fromName?: string): string {
  const fallback = 'lefta.app <noreply@lefta.app>';
  const raw = configured?.trim() || fallback;

  const angled = /<([^>]+)>/.exec(raw);
  const address = (angled?.[1] ?? raw).trim();

  // Quotes and backslashes would break the quoting, angle brackets would close
  // the address early, and any control character could end the header outright.
  const name = fromName
    ?.replace(/["\\<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return raw;

  return `${name} <${address}>`;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

let client: Resend | null = null;

function resend(): Resend {
  if (!client) client = new Resend(requireEnv('RESEND_API_KEY'));
  return client;
}

/**
 * Sends one transactional email.
 *
 * Never throws: the dunning engine records the outcome of every attempt in the
 * audit log, so a provider failure must come back as data, not an exception that
 * aborts the rest of the run.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const from = fromHeader(optionalEnv('EMAIL_FROM'), message.fromName);

  // Local development without a provider key: log and report success so the
  // whole workflow stays exercisable end to end.
  if (!optionalEnv('RESEND_API_KEY')) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'RESEND_API_KEY is not configured' };
    }
    console.info('[email:dry-run]', {
      to: message.to,
      subject: message.subject,
      preview: message.text.slice(0, 160),
    });
    return { ok: true, messageId: `dry-run-${Date.now()}` };
  }

  try {
    const { data, error } = await resend().emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true, messageId: data?.id };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
