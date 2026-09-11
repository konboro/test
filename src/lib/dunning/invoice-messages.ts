import type { CommChannel, DunningStep } from '@/types/database';

import { slotKey, type TemplateOverrides } from './templates';

/**
 * One invoice's own wording, as a form talks about it.
 *
 * The same contract as the per-invoice cadence: the editor shows the account's
 * effective text and submits whatever is on screen; text identical to the
 * account is not an override and is never stored, so an untouched invoice
 * keeps following the account template — including its future edits.
 */

/** Prefixed like the cadence fields, so nothing collides on the create form. */
export const MESSAGE_FIELD = {
  subject: (step: string, channel: string) => `msg_${step}_${channel}_subject`,
  body: (step: string, channel: string) => `msg_${step}_${channel}_body`,
} as const;

/** Mirrored from the check constraints on the table. */
export const MESSAGE_LIMITS = { subject: 300, body: 4000 } as const;

/** The account's effective wording for the notice — what the editor prefills. */
export interface NoticeTexts {
  emailSubject: string;
  emailBody: string;
  smsBody: string;
}

export interface InvoiceMessageInput {
  step: DunningStep;
  channel: CommChannel;
  subject: string | null;
  body: string;
}

const clip = (value: string, max: number) => value.slice(0, max);

/**
 * Reads the quick editor back out of a submitted form.
 *
 * Only the notice on issue, for now — the fields carry the step in their names
 * so reminders can join later without a schema change.
 *
 * An empty body is "no override", not "send nothing": switching the whole
 * notice off already has a control of its own, and an accidentally cleared
 * textarea must fall back to the account wording rather than silence or an
 * empty email. A form that never rendered the fields parses to nothing at all.
 */
export function parseInvoiceMessages(
  formData: Pick<FormData, 'get'>,
  effective: NoticeTexts,
): InvoiceMessageInput[] {
  const read = (name: string): string | null => {
    const raw = formData.get(name);
    return typeof raw === 'string' ? raw : null;
  };

  const rows: InvoiceMessageInput[] = [];

  const emailSubject = read(MESSAGE_FIELD.subject('on_issue', 'email'));
  const emailBody = read(MESSAGE_FIELD.body('on_issue', 'email'));

  if (emailBody !== null && emailBody.trim()) {
    const subject = clip((emailSubject ?? '').trim(), MESSAGE_LIMITS.subject);
    const body = clip(emailBody.trim(), MESSAGE_LIMITS.body);

    const untouched =
      subject === effective.emailSubject.trim() && body === effective.emailBody.trim();

    if (!untouched) {
      rows.push({ step: 'on_issue', channel: 'email', subject: subject || null, body });
    }
  }

  const smsBody = read(MESSAGE_FIELD.body('on_issue', 'sms'));

  if (smsBody !== null && smsBody.trim()) {
    const body = clip(smsBody.trim(), MESSAGE_LIMITS.body);

    if (body !== effective.smsBody.trim()) {
      rows.push({ step: 'on_issue', channel: 'sms', subject: null, body });
    }
  }

  return rows;
}

/**
 * The invoice's wording laid over the account's, in the shape the dispatcher
 * already reads. The dispatcher does not know invoices have wording of their
 * own — it sees one resolved set of templates, which keeps the render path
 * single and the precedence in exactly one place: invoice row, else account
 * override, else built-in copy.
 */
export function overlayInvoiceMessages(
  overrides: TemplateOverrides,
  rows: ReadonlyArray<InvoiceMessageInput>,
): TemplateOverrides {
  if (!rows.length) return overrides;

  const merged: TemplateOverrides = { ...overrides };

  for (const row of rows) {
    merged[slotKey(row.step, row.channel)] = { subject: row.subject, body: row.body };
  }

  return merged;
}
