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
 * Whether the provider refused because we asked too quickly.
 *
 * Worth telling apart from every other failure: a rejected address is final and
 * a rate limit is a timing problem that will not exist a second from now. A
 * batch of eighty-seven reminders lost thirty-six of them to this, all reported
 * as failures, all perfectly deliverable.
 */
export function isRateLimited(error: string | null | undefined): boolean {
  const text = (error ?? '').toLowerCase();
  return text.includes('too many requests') || text.includes('rate limit') || text.includes('429');
}

/** Waits, so a retry is not the same burst again. */
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * How long to wait before each retry.
 *
 * Growing, with a little scatter: a batch that hits the limit hits it on many
 * sends at once, and retrying all of them on the same schedule reproduces the
 * burst that caused it.
 */
function backoffMs(attempt: number): number {
  return attempt * 400 + Math.floor(Math.random() * 250);
}

/** Attempts after the first. Three covers a burst; more would just be slower. */
const RETRIES = 3;

/**
 * Sends one transactional email.
 *
 * Never throws: the dunning engine records the outcome of every attempt in the
 * audit log, so a provider failure must come back as data, not an exception that
 * aborts the rest of the run.
 *
 * A rate limit is retried here rather than by the caller. The caller has already
 * claimed the customer's one contact for the day before it gets a result, so a
 * retry from up there would either be refused by its own guarantee or would have
 * to reach around it — and the honest reading is that nothing was sent yet.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  let result = await attemptSend(message);

  for (let attempt = 1; attempt <= RETRIES && !result.ok && isRateLimited(result.error); attempt += 1) {
    await pause(backoffMs(attempt));
    result = await attemptSend(message);
  }

  return result;
}

async function attemptSend(message: EmailMessage): Promise<SendResult> {
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
