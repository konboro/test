import { formatDate, formatMoney } from '@/lib/money';
import type { DunningStep } from '@/types/database';

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
 * The wording stays factual throughout: it states the document, the amount, the
 * due date and a payment link. It never threatens legal action, adds fees, or
 * implies collection activity — lefta transmits reminders on the creditor's
 * behalf as a software provider, and the copy has to reflect that at every step.
 */

function shell(bodyHtml: string, payUrl: string, creditorName: string): string {
  return `<!doctype html>
<html lang="el">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
    <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:32px;">
          ${bodyHtml}
          <p style="margin:28px 0 0;">
            <a href="${payUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
              Πληρωμή τώρα
            </a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.6;">
            Αν έχετε ήδη εξοφλήσει, αγνοήστε αυτό το μήνυμα.<br />
            Το μήνυμα αποστέλλεται αυτόματα για λογαριασμό της ${escapeHtml(creditorName)}
            μέσω της πλατφόρμας lefta.app.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmail(step: DunningStep, ctx: TemplateContext): RenderedEmail {
  const amount = formatMoney(ctx.amountCents, ctx.currency);
  const due = formatDate(ctx.dueDate);

  if (step === 'pre_due') {
    const subject = `Υπενθύμιση: το παραστατικό ${ctx.invoiceLabel} λήγει στις ${due}`;
    const text = [
      `Αγαπητοί συνεργάτες (${ctx.debtorName}),`,
      '',
      `σας υπενθυμίζουμε ότι το παραστατικό ${ctx.invoiceLabel} ποσού ${amount} λήγει στις ${due}.`,
      '',
      `Μπορείτε να εξοφλήσετε ηλεκτρονικά εδώ: ${ctx.payUrl}`,
      '',
      `Με εκτίμηση,`,
      ctx.creditorName,
    ].join('\n');

    return {
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;">Αγαπητοί συνεργάτες (<strong>${escapeHtml(ctx.debtorName)}</strong>),</p>
         <p style="margin:0 0 16px;line-height:1.6;">σας υπενθυμίζουμε ότι το παραστατικό
         <strong>${escapeHtml(ctx.invoiceLabel)}</strong> ποσού <strong>${amount}</strong>
         λήγει στις <strong>${due}</strong>.</p>
         <p style="margin:0;line-height:1.6;">Με εκτίμηση,<br />${escapeHtml(ctx.creditorName)}</p>`,
        ctx.payUrl,
        ctx.creditorName,
      ),
    };
  }

  if (step === 'overdue_2') {
    const subject = `Ληξιπρόθεσμο παραστατικό ${ctx.invoiceLabel} — ${amount}`;
    const text = [
      `Αγαπητοί συνεργάτες (${ctx.debtorName}),`,
      '',
      `το παραστατικό ${ctx.invoiceLabel} ποσού ${amount} είχε ημερομηνία λήξης ${due} και εμφανίζεται ως ανεξόφλητο.`,
      '',
      `Εξόφληση: ${ctx.payUrl}`,
      '',
      `Αν υπάρχει κάποιο θέμα με το παραστατικό, επικοινωνήστε μαζί μας.`,
      '',
      `Με εκτίμηση,`,
      ctx.creditorName,
    ].join('\n');

    return {
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;">Αγαπητοί συνεργάτες (<strong>${escapeHtml(ctx.debtorName)}</strong>),</p>
         <p style="margin:0 0 16px;line-height:1.6;">το παραστατικό
         <strong>${escapeHtml(ctx.invoiceLabel)}</strong> ποσού <strong>${amount}</strong>
         είχε ημερομηνία λήξης <strong>${due}</strong> και εμφανίζεται ως ανεξόφλητο.</p>
         <p style="margin:0 0 16px;line-height:1.6;">Αν υπάρχει κάποιο θέμα με το παραστατικό,
         επικοινωνήστε μαζί μας.</p>
         <p style="margin:0;line-height:1.6;">Με εκτίμηση,<br />${escapeHtml(ctx.creditorName)}</p>`,
        ctx.payUrl,
        ctx.creditorName,
      ),
    };
  }

  const subject = `Τελική υπενθύμιση — παραστατικό ${ctx.invoiceLabel} (${amount})`;
  const text = [
    `Αγαπητοί συνεργάτες (${ctx.debtorName}),`,
    '',
    `πρόκειται για την τελευταία αυτοματοποιημένη υπενθύμιση για το παραστατικό ${ctx.invoiceLabel} ποσού ${amount}, με ημερομηνία λήξης ${due}.`,
    '',
    `Εξόφληση: ${ctx.payUrl}`,
    '',
    `Μετά από αυτό το μήνυμα δεν θα σταλούν άλλες αυτόματες υπενθυμίσεις. Για οποιοδήποτε ερώτημα ή διακανονισμό, επικοινωνήστε απευθείας μαζί μας.`,
    '',
    `Με εκτίμηση,`,
    ctx.creditorName,
  ].join('\n');

  return {
    subject,
    text,
    html: shell(
      `<p style="margin:0 0 16px;">Αγαπητοί συνεργάτες (<strong>${escapeHtml(ctx.debtorName)}</strong>),</p>
       <p style="margin:0 0 16px;line-height:1.6;">πρόκειται για την τελευταία αυτοματοποιημένη
       υπενθύμιση για το παραστατικό <strong>${escapeHtml(ctx.invoiceLabel)}</strong> ποσού
       <strong>${amount}</strong>, με ημερομηνία λήξης <strong>${due}</strong>.</p>
       <p style="margin:0 0 16px;line-height:1.6;">Μετά από αυτό το μήνυμα δεν θα σταλούν άλλες
       αυτόματες υπενθυμίσεις. Για οποιοδήποτε ερώτημα ή διακανονισμό, επικοινωνήστε απευθείας
       μαζί μας.</p>
       <p style="margin:0;line-height:1.6;">Με εκτίμηση,<br />${escapeHtml(ctx.creditorName)}</p>`,
      ctx.payUrl,
      ctx.creditorName,
    ),
  };
}

/**
 * SMS copy. Kept deliberately terse — Greek text is UCS-2, so anything past
 * 70 characters costs a second segment (and a second credit).
 */
export function renderSms(step: DunningStep, ctx: TemplateContext): string {
  const amount = formatMoney(ctx.amountCents, ctx.currency);

  if (step === 'overdue_2') {
    return `${ctx.creditorName}: το παραστατικό ${ctx.invoiceLabel} (${amount}) είναι ληξιπρόθεσμο. Εξόφληση: ${ctx.payUrl}`;
  }

  return `${ctx.creditorName}: τελική υπενθύμιση για το ${ctx.invoiceLabel} (${amount}). Εξόφληση: ${ctx.payUrl}`;
}
