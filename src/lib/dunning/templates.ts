import type { Locale } from '@/lib/i18n/dictionaries';
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

/**
 * A slot is one ladder step on one channel, or one named manual wording.
 *
 * `penny:email` is not a fourth rung. A rung fires once per invoice, is placed
 * by the scenario and is bound by the daily contact limit; a named wording is
 * only ever chosen by a person, and choosing it consumes nothing. Holding both
 * in one key space is safe precisely because a variant is allowed only where
 * the step is already null — a check constraint enforces that, not this type.
 */
export type TemplateSlotKey =
  | `${'pre_due' | 'overdue_2' | 'overdue_10' | 'manual'}:${CommChannel}`
  | 'penny:email';

/** Names a manual wording. Null is the plain manual reminder. */
export type TemplateVariant = 'penny' | null;

export function slotKey(
  step: TemplateStep,
  channel: CommChannel,
  variant: TemplateVariant = null,
): TemplateSlotKey {
  if (variant) return `${variant}:${channel}` as TemplateSlotKey;
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
  variant?: TemplateVariant;
  label: string;
}> = [
  { key: 'pre_due:email', step: 'pre_due', channel: 'email', label: 'Βήμα 1 — πριν τη λήξη (email)' },
  { key: 'overdue_2:email', step: 'overdue_2', channel: 'email', label: 'Βήμα 2 — ληξιπρόθεσμο (email)' },
  { key: 'overdue_2:sms', step: 'overdue_2', channel: 'sms', label: 'Βήμα 2 — ληξιπρόθεσμο (SMS)' },
  { key: 'overdue_10:email', step: 'overdue_10', channel: 'email', label: 'Βήμα 3 — τελική υπενθύμιση (email)' },
  { key: 'overdue_10:sms', step: 'overdue_10', channel: 'sms', label: 'Βήμα 3 — τελική υπενθύμιση (SMS)' },
  { key: 'manual:email', step: null, channel: 'email', label: 'Χειροκίνητη υπενθύμιση (email)' },
  { key: 'manual:sms', step: null, channel: 'sms', label: 'Χειροκίνητη υπενθύμιση (SMS)' },
  // A second manual wording, for a debtor who is a person rather than a
  // business. Email only: the SMS side of this copy has not been written, and
  // an editable body that nothing ever sends is worse than its absence.
  {
    key: 'penny:email',
    step: null,
    channel: 'email',
    variant: 'penny',
    label: 'Penny email — ιδιώτης πελάτης',
  },
];

/** Validates a slot key coming from a form and splits it back into its parts. */
export function parseSlotKey(
  value: string,
): { step: TemplateStep; channel: CommChannel; variant: TemplateVariant } | null {
  const slot = EDITABLE_SLOTS.find((s) => s.key === value);
  return slot ? { step: slot.step, channel: slot.channel, variant: slot.variant ?? null } : null;
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
  variant?: TemplateVariant;
  label: string;
}> = [
  { value: 'manual', step: null, label: 'Χειροκίνητη υπενθύμιση' },
  { value: 'penny', step: null, variant: 'penny', label: 'Penny email — ιδιώτης πελάτης' },
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

/**
 * The whole slot a picker value renders with — ladder position and wording.
 *
 * `parseReminderChoice` answers only the first half, and is kept for the
 * callers that genuinely want a ladder position. Anything that renders copy
 * wants this instead: two choices may share a step and differ in wording, and
 * resolving by step alone quietly sends the wrong one.
 */
export function parseReminderSlot(
  value: string,
): { step: TemplateStep; variant: TemplateVariant } | undefined {
  const choice = REMINDER_CHOICES.find((c) => c.value === value);
  return choice ? { step: choice.step, variant: choice.variant ?? null } : undefined;
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
  // Addressed to a person who owes for a ride, not to a company that owes on an
  // invoice. Singular and informal throughout, and no gendered salutation —
  // `{{debtor_name}}` is a name, which says nothing about how to address its
  // owner. It names the likely cause on purpose: most of these are a card that
  // expired, and someone who knows that fixes it instead of wondering what the
  // message is about. The document number stays in the facts box above.
  'penny:email': {
    subject: 'Εκκρεμεί η πληρωμή σου — {{amount}}',
    body: [
      'Γεια σου {{debtor_name}},',
      '',
      'η χρέωση των {{amount}} για τη διαδρομή σου δεν ολοκληρώθηκε, οπότε το ποσό παραμένει ανοιχτό. Προθεσμία εξόφλησης: {{due_date}}.',
      '',
      'Συνήθως φταίει κάτι απλό — μια κάρτα που έληξε ή ένα προσωρινό όριο της τράπεζας.',
      '',
      'Μπορείς να το τακτοποιήσεις με κάρτα σε λιγότερο από ένα λεπτό, χωρίς να ανοίξεις την εφαρμογή:',
      '{{pay_url}}',
      '',
      'Αν το έχεις ήδη πληρώσει, αγνόησε αυτό το μήνυμα.',
      '',
      'Καλές διαδρομές,',
      '{{creditor_name}}',
    ].join('\n'),
  },
};


/**
 * The same slots in English.
 *
 * Written rather than translated at send time: a reminder is a legal-ish
 * document about money owed, and a machine translation of it going out under
 * the creditor's name is not something to discover after the fact.
 *
 * Kept deliberately plainer than the Greek. The Greek copy addresses a company
 * in the formal plural, which English has no equivalent for; reaching for
 * "Dear Sirs" would be a worse match than a neutral greeting.
 */
const TEMPLATES_EN: Record<TemplateSlotKey, { subject: string | null; body: string }> = {
  'pre_due:email': {
    subject: 'Reminder: invoice {{invoice}} is due on {{due_date}}',
    body: [
      'Dear {{debtor_name}},',
      '',
      'this is a reminder that invoice {{invoice}} for {{amount}} is due on {{due_date}}.',
      '',
      'You can pay online here: {{pay_url}}',
      '',
      'Kind regards,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'pre_due:sms': {
    subject: null,
    body: '{{creditor_name}}: invoice {{invoice}} ({{amount}}) is due {{due_date}}. Pay: {{pay_url}}',
  },
  'overdue_2:email': {
    subject: 'Overdue invoice {{invoice}} — {{amount}}',
    body: [
      'Dear {{debtor_name}},',
      '',
      'invoice {{invoice}} for {{amount}} was due on {{due_date}} and is still showing as unpaid.',
      '',
      'Pay: {{pay_url}}',
      '',
      'If there is a problem with the invoice, please get in touch.',
      '',
      'Kind regards,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'overdue_2:sms': {
    subject: null,
    body: '{{creditor_name}}: invoice {{invoice}} ({{amount}}) is overdue. Pay: {{pay_url}}',
  },
  'overdue_10:email': {
    subject: 'Final reminder — invoice {{invoice}} ({{amount}})',
    body: [
      'Dear {{debtor_name}},',
      '',
      'this is the last automatic reminder for invoice {{invoice}} for {{amount}}, which was due on {{due_date}}.',
      '',
      'Pay: {{pay_url}}',
      '',
      'No further automatic reminders will be sent after this message. For any question or to arrange payment, please contact us directly.',
      '',
      'Kind regards,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'overdue_10:sms': {
    subject: null,
    body: '{{creditor_name}}: final reminder for {{invoice}} ({{amount}}). Pay: {{pay_url}}',
  },
  'manual:email': {
    subject: 'Payment reminder — invoice {{invoice}}',
    body: [
      'Dear {{debtor_name}},',
      '',
      'a reminder about invoice {{invoice}} for {{amount}}, due on {{due_date}}.',
      '',
      'Pay: {{pay_url}}',
      '',
      'Kind regards,',
      '{{creditor_name}}',
    ].join('\n'),
  },
  'manual:sms': {
    subject: null,
    body: '{{creditor_name}}: reminder for {{invoice}} ({{amount}}). Pay: {{pay_url}}',
  },
  'penny:email': {
    subject: 'Your payment is still open — {{amount}}',
    body: [
      'Hi {{debtor_name}},',
      '',
      'the {{amount}} charge for your ride did not go through, so the amount is still open. Due by {{due_date}}.',
      '',
      'It is usually something simple — a card that expired, or a temporary limit from your bank.',
      '',
      'You can sort it out by card in under a minute, without opening the app:',
      '{{pay_url}}',
      '',
      'If you have already paid, please ignore this message.',
      '',
      'Safe rides,',
      '{{creditor_name}}',
    ].join('\n'),
  },
};

/** The built-in copy, per language. A tenant's overrides sit on top of this. */
const BUILT_IN_TEMPLATES: Record<Locale, Record<TemplateSlotKey, { subject: string | null; body: string }>> = {
  el: DEFAULT_TEMPLATES,
  en: TEMPLATES_EN,
};

/**
 * The built-in copy for a slot, if one was written.
 *
 * Indexed through a partial type on purpose: a named wording does not have to
 * cover every channel, so this lookup genuinely can miss, and the declared
 * Record type would otherwise promise a value that is not there.
 */
function builtIn(
  key: TemplateSlotKey,
  locale: Locale = 'el',
): { subject: string | null; body: string } | undefined {
  const table: Partial<Record<TemplateSlotKey, { subject: string | null; body: string }>> =
    BUILT_IN_TEMPLATES[locale];
  return table[key];
}

/**
 * The template in force for a slot: the tenant's override, else the built-in.
 *
 * A named wording falls back to the plain slot for any channel it does not
 * define. `penny` is email-only, and a manual send to a debtor who has both an
 * address and a phone renders both channels — without this it would ask for
 * `penny:sms`, which was never written, and throw on the way to a message the
 * operator had every reason to expect.
 */
export function templateFor(
  step: TemplateStep,
  channel: CommChannel,
  overrides: TemplateOverrides = {},
  variant: TemplateVariant = null,
  locale: Locale = 'el',
): { subject: string | null; body: string } {
  const key = slotKey(step, channel, variant);
  const chosen = overrides[key] ?? builtIn(key, locale);
  if (chosen) return chosen;

  const base = slotKey(step, channel);
  return overrides[base] ?? BUILT_IN_TEMPLATES[locale][base];
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
/**
 * The document-summary box between the copy and the button. The tenant's prose
 * may or may not restate the numbers; this block states them in one fixed,
 * scannable place, the way a receipt would — and it is part of the frame, so a
 * template override cannot remove or forge it.
 */
function factsBlock(ctx: TemplateContext): string {
  const row = (label: string, value: string, emphasis = false) => `
                        <tr>
                          <td style="padding:4px 0;font-size:13px;color:#64748b;${emphasis ? 'border-top:1px solid #e2e8f0;padding-top:9px;' : ''}">${label}</td>
                          <td align="right" style="padding:4px 0;font-size:${emphasis ? '15px' : '13px'};font-weight:${emphasis ? '700' : '600'};color:#0f172a;${emphasis ? 'border-top:1px solid #e2e8f0;padding-top:9px;' : ''}">${value}</td>
                        </tr>`;

  return `
                  <tr>
                    <td style="padding:8px 32px 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                        <tr>
                          <td style="padding:12px 18px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                              ${row('Παραστατικό', escapeHtml(ctx.invoiceLabel))}
                              ${row('Ημερομηνία λήξης', escapeHtml(formatDate(ctx.dueDate)))}
                              ${row('Οφειλόμενο ποσό', escapeHtml(formatMoney(ctx.amountCents, ctx.currency)), true)}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`;
}

function shell(
  bodyHtml: string,
  payUrl: string,
  creditorName: string,
  preheader: string,
  factsHtml = '',
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
              <td style="padding:0 4px 14px;">
                <!-- The mark, drawn with a background colour and a λ glyph rather
                     than the SVG the app uses: Gmail strips inline SVG, and a
                     hosted image would be blocked until the reader opts in.
                     Outlook ignores border-radius and shows a square tile, which
                     is a fair degradation. -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="22" height="22" align="center" valign="middle" style="width:22px;height:22px;background:#4c6ef5;border-radius:5px;font-size:15px;line-height:22px;font-weight:700;color:#ffffff;">&#955;</td>
                  <td style="padding-left:8px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;white-space:nowrap;">
                    lefta<span style="color:#3b6df5;">.app</span>
                  </td>
                </tr></table>
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
${factsHtml}
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
  variant: TemplateVariant = null,
  locale: Locale = 'el',
): RenderedEmail {
  const template = templateFor(step, 'email', overrides, variant, locale);
  // A tenant may clear the subject on an override; the built-in one for the
  // same slot then stands in, and the plain slot's behind that.
  const subject = applyPlaceholders(
    template.subject ??
      builtIn(slotKey(step, 'email', variant), locale)?.subject ??
      builtIn(slotKey(step, 'email'), locale)?.subject ??
      '',
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
    html: shell(toParagraphs(text), ctx.payUrl, ctx.creditorName, preheader, factsBlock(ctx)),
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
  variant: TemplateVariant = null,
  locale: Locale = 'el',
): string {
  return applyPlaceholders(templateFor(step, 'sms', overrides, variant, locale).body, ctx);
}
