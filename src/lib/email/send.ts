import { Resend } from 'resend';

import { optionalEnv, requireEnv } from '@/lib/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
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
  const from = optionalEnv('EMAIL_FROM') ?? 'lefta.app <noreply@lefta.app>';

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
