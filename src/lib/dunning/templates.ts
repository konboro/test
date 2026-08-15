import { formatDate, formatMoney } from '@/lib/money';
import type { CommChannel, TemplateStep } from '@/types/database';

export interface TemplateContext {
  debtorName: string;
  creditorName: string;
  invoiceLabel: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  payUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Reminder copy, in Greek.
 *
 * The built-in wording stays factual throughout: it states the document, the
 * amount, the due date and a payment link. It never threatens legal action, adds
 * fees, or implies collection activity — lefta transmits reminders on the
 * creditor's behalf as a software provider, and the copy has to reflect that.
 *
 * Tenants may replace any of it. What they cannot replace is the frame: the
 * platform footer and the payment button are part of the shell, and a custom
 * body is escaped into it as text rather than markup. A template is copy, not a
 * way to author arbitrary HTML in a message sent on someone else's behalf.
 */

/** A slot is one ladder step (or the manual reminder) on one channel. */
export type TemplateSlotKey = `${'pre_due' | 'overdue_2' | 'overdue_10' | 'manual'}:${CommChannel}`;

export function slotKey(step: TemplateStep, channel: CommChannel): TemplateSlotKey {
  return `${step ?? 'manual'}:${channel}` as TemplateSlotKey;
}

/** A tenant's overrides, keyed by slot. A missing slot falls back to the default. */
export type TemplateOverrides = Partial<
  Record<TemplateSlotKey, { subject: string | null; body: string }>
>;

/**
 * The slots offered in the editor, in the order the recipient meets them.
 *
 * `pre_due:sms` is deliberately absent: step 1 is email-only, so exposing an SMS
 * body for it would invite someone to write copy that is never sent.
 */
export const EDITABLE_SLOTS: ReadonlyArray<{
  key: TemplateSlotKey;
  step: TemplateStep;
  channel: CommChannel;
  label: string;
}> = [
  { key: 'pre_due:email', step: 'pre_due', channel: 'email', label: 'Βήμα 1 — πριν τη λήξη (email)' },
  { key: 'overdue_2:email', step: 'overdue_2', channel: 'email', label: 'Βήμα 2 — ληξιπρόθεσμο (email)' },
  { key: 'overdue_2:sms', step: 'overdue_2', channel: 'sms', label: 'Βήμα 2 — ληξιπρόθεσμο (SMS)' },
  { key: 'overdue_10:email', step: 'overdue_10', channel: 'email', label: 'Βήμα 3 — τελική υπενθύμιση (email)' },
  { key: 'overdue_10:sms', step: 'overdue_10', channel: 'sms', label: 'Βήμα 3 — τελική υπενθύμιση (SMS)' },
  { key: 'manual:email', step: null, channel: 'email', label: 'Χειροκίνητη υπενθύμιση (email)' },
  { key: 'manual:sms', step: null, channel: 'sms', label: 'Χειροκίνητη υπενθύμιση (SMS)' },
];

/** Validates a slot key coming from a form and splits it back into its parts. */
export function parseSlotKey(
  value: string,
): { step: TemplateStep; channel: CommChannel } | null {
  const slot = EDITABLE_SLOTS.find((s) => s.key === value);
  return slot ? { step: slot.step, channel: slot.channel } : null;
}

/**
 * Wordings offered when sending a reminder by hand.
 *
 * This picks the *copy*, not a position on the ladder. Sending the step 3 text
 * today does not mark step 3 as done — a manual contact never consumes a rung,
 * so the automated escalation still runs its course afterwards.
 */
export const REMINDER_CHOICES: ReadonlyArray<{
  value: string;
  step: TemplateStep;
  label: string;
}> = [
  { value: 'manual', step: null, label: 'Χειροκίνητη υπενθύμιση' },
  { value: 'pre_due', step: 'pre_due', label: 'Κείμενο βήματος 1 — πριν τη λήξη' },
  { value: 'overdue_2', step: 'overdue_2', label: 'Κείμενο βήματος 2 — ληξιπρόθεσμο' },
  { value: 'overdue_10', step: 'overdue_10', label: 'Κείμενο βήματος 3 — τελική υπενθύμιση' },
];

/**
 * Resolves a picker value to the template step it renders with.
 *
 * Returns `undefined` — not `null` — for an unknown value, because `null` is a
 * legitimate step meaning "the manual slot" and the two must not be confused.
 */
export function parseReminderChoice(value: string): TemplateStep | undefined {
  const choice = REMINDER_CHOICES.find((c) => c.value === value);
  return choice ? choice.step : undefined;
}

export interface PlaceholderInfo {
  token: string;
  label: string;
}

/** Offered by the template editor; every one is always substituted. */
export const PLACEHOLDERS: ReadonlyArray<PlaceholderInfo> = [
  { token: '{{debtor_name}}', label: 'Επωνυμία πελάτη' },
  { token: '{{creditor_name}}', label: 'Η επωνυμία σας' },
  { token: '{{invoice}}', label: 'Παραστατικό (σειρά + αριθμός)' },
  { token: '{{amount}}', label: 'Ποσό' },
  { token: '{{due_date}}', label: 'Ημερομηνία λήξης' },
  { token: '{{pay_url}}', label: 'Σύνδεσμος πληρωμής' },
];

/**
 * Substitutes every placeholder. Unknown `{{tokens}}` are left untouched rather
 * than blanked, so a typo is visible in the preview instead of silently eating
 * part of the sentence.
 */
export function applyPlaceholders(template: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    debtor_name: ctx.debtorName,
    creditor_name: ctx.creditorName,
    invoice: ctx.invoiceLabel,
    amount: formatMoney(ctx.amountCents, ctx.currency),
    due_date: formatDate(ctx.dueDate),
    pay_url: ctx.payUrl,
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, token: string) => {
    const value = values[token];
    return value === undefined ? whole : value;
  });
}

export const DEFAULT_TEMPLATES: Record<
  TemplateSlotKey,
  { subject: string | null; body: string }
> = {
  'pre_due:email': {
    subject: 'Υπενθύμιση: το παραστατικό {{invoice}} λήγει στις {{due_date}}',
    body: [
      'Αγαπητοί συνεργάτες ({{debtor_name}}),',
      '',
      'σας υπενθυμίζουμε ότι το παραστατικό {{invoice}} ποσού {{amount}} λήγει στις {{due_date}}.',
      '',
      'Μπορείτε να εξοφλήσετε ηλεκτρονικά εδώ: {{pay_url}}',
      '',
      'Με εκτίμηση,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  // The pre-due step is email-only; this exists so every slot has a default.
  'pre_due:sms': {
    subject: null,
    body: '{{creditor_name}}: το {{invoice}} ({{amount}}) λήγει {{due_date}}. Εξόφληση: {{pay_url}}',
  },
  'overdue_2:email': {
    subject: 'Ληξιπρόθεσμο παραστατικό {{invoice}} — {{amount}}',
    body: [
      'Αγαπητοί συνεργάτες ({{debtor_name}}),',
      '',
      'το παραστατικό {{invoice}} ποσού {{amount}} είχε ημερομηνία λήξης {{due_date}} και εμφανίζεται ως ανεξόφλητο.',
      '',
      'Εξόφληση: {{pay_url}}',
      '',
      'Αν υπάρχει κάποιο θέμα με το παραστατικό, επικοινωνήστε μαζί μας.',
      '',
      'Με εκτίμηση,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'overdue_2:sms': {
    subject: null,
    body: '{{creditor_name}}: το παραστατικό {{invoice}} ({{amount}}) είναι ληξιπρόθεσμο. Εξόφληση: {{pay_url}}',
  },
  'overdue_10:email': {
    subject: 'Τελική υπενθύμιση — παραστατικό {{invoice}} ({{amount}})',
    body: [
      'Αγαπητοί συνεργάτες ({{debtor_name}}),',
      '',
      'πρόκειται για την τελευταία αυτοματοποιημένη υπενθύμιση για το παραστατικό {{invoice}} ποσού {{amount}}, με ημερομηνία λήξης {{due_date}}.',
      '',
      'Εξόφληση: {{pay_url}}',
      '',
      'Μετά από αυτό το μήνυμα δεν θα σταλούν άλλες αυτόματες υπενθυμίσεις. Για οποιοδήποτε ερώτημα ή διακανονισμό, επικοινωνήστε απευθείας μαζί μας.',
      '',
      'Με εκτίμηση,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'overdue_10:sms': {
    subject: null,
    body: '{{creditor_name}}: τελική υπενθύμιση για το {{invoice}} ({{amount}}). Εξόφληση: {{pay_url}}',
  },
  'manual:email': {
    subject: 'Υπενθύμιση πληρωμής — παραστατικό {{invoice}}',
    body: [
      'Αγαπητοί συνεργάτες ({{debtor_name}}),',
      '',
      'σας υπενθυμίζουμε το παραστατικό {{invoice}} ποσού {{amount}}, με ημερομηνία λήξης {{due_date}}.',
      '',
      'Εξόφληση: {{pay_url}}',
      '',
      'Με εκτίμηση,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'manual:sms': {
    subject: null,
    body: '{{creditor_name}}: υπενθύμιση για το {{invoice}} ({{amount}}). Εξόφληση: {{pay_url}}',
  },
};

/** The template in force for a slot: the tenant's override, else the built-in. */
export function templateFor(
  step: TemplateStep,
  channel: CommChannel,
  overrides: TemplateOverrides = {},
): { subject: string | null; body: string } {
  const key = slotKey(step, channel);
  return overrides[key] ?? DEFAULT_TEMPLATES[key];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain-text body → escaped HTML paragraphs, preserving the author's breaks. */
function toParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        // Colour and line-height repeated on every paragraph: several clients
        // drop inheritance into block elements.
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`,
    )
    .join('\n');
}

/**
 * The email frame.
 *
 * Table-based and fully inline-styled on purpose: Gmail strips <style> blocks,
 * Outlook renders with Word's engine, and neither supports flex or grid. The
 * palette mirrors the app — slate text, brand blue for the one action — so a
 * reminder looks like it came from the same product as the payment page it
 * links to.
 */
function shell(
  bodyHtml: string,
  payUrl: string,
  creditorName: string,
  preheader: string,
): string {
  const safeUrl = escapeHtml(payUrl);

  return `<!doctype html>
<html lang="el">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(creditorName)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <!-- Inbox preview line. Hidden in the message body itself. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 14px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;">
                lefta<span style="color:#3b6df5;">.app</span>
              </td>
            </tr>

            <tr>
              <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:32px 32px 8px;font-size:15px;line-height:1.65;color:#334155;">
                      ${bodyHtml}
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:16px 32px 32px;">
                      <!-- Bulletproof-ish button: a padded table cell, because
                           Outlook ignores padding on an inline-block anchor. -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td bgcolor="#2b55d4" style="border-radius:10px;">
                            <a href="${safeUrl}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                              Πληρωμή τώρα
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
                        <a href="${safeUrl}" style="color:#2b55d4;text-decoration:none;">${safeUrl}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 8px 0;font-size:12px;line-height:1.7;color:#64748b;">
                Αν έχετε ήδη εξοφλήσει, αγνοήστε αυτό το μήνυμα.<br />
                Αποστέλλεται για λογαριασμό της
                <span style="color:#334155;">${escapeHtml(creditorName)}</span>
                μέσω της πλατφόρμας lefta.app.
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEmail(
  step: TemplateStep,
  ctx: TemplateContext,
  overrides: TemplateOverrides = {},
): RenderedEmail {
  const template = templateFor(step, 'email', overrides);
  const subject = applyPlaceholders(
    template.subject ?? DEFAULT_TEMPLATES[slotKey(step, 'email')].subject ?? '',
    ctx,
  );
  const text = applyPlaceholders(template.body, ctx);

  // The inbox preview line. The greeting is the same on every reminder, so the
  // second paragraph carries the actual news and makes the more useful preview.
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const preheader = blocks[1] ?? blocks[0] ?? subject;

  return {
    subject,
    text,
    html: shell(toParagraphs(text), ctx.payUrl, ctx.creditorName, preheader),
  };
}

/**
 * SMS copy. Kept deliberately terse — Greek text is UCS-2, so anything past
 * 70 characters costs a second segment (and a second credit).
 */
export function renderSms(
  step: TemplateStep,
  ctx: TemplateContext,
  overrides: TemplateOverrides = {},
): string {
  return applyPlaceholders(templateFor(step, 'sms', overrides).body, ctx);
}
