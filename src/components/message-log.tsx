import { Badge } from '@/components/ui';
import { stepShort as shortStepLabels } from '@/lib/dunning/status';
import { getDictionary } from '@/lib/i18n';
import type { CommStatus, CommunicationLogRow } from '@/types/database';

/**
 * The list of messages that went out, as one rendering used everywhere.
 *
 * Extracted when the customer page needed the same list the log page already
 * had. Two renderings of a compliance record would eventually disagree about
 * what a failed send looks like, and the one nobody was watching would be the
 * one that was wrong.
 *
 * Each entry is collapsed to what identifies it — who it went to, when, and
 * what it was about — with the body behind a toggle. Printed in full, three
 * reminders filled the screen with the same paragraph three times and the
 * customer page became a wall of text you had to scroll past to reach anything
 * else. The record is not shortened, only folded: every word is still one click
 * away, and still in the DOM for a find-in-page.
 *
 * `details`/`summary` rather than state, so this stays a server component with
 * no JavaScript of its own — and keeps working in an email-print, a text
 * browser, or with scripting off.
 */

const STATUS_TONE: Record<CommStatus, 'positive' | 'danger' | 'neutral'> = {
  sent: 'positive',
  failed: 'danger',
  skipped: 'neutral',
};

export type MessageLogEntry = Pick<
  CommunicationLogRow,
  | 'id'
  | 'debtor_id'
  | 'channel'
  | 'step'
  | 'status'
  | 'recipient'
  | 'subject'
  | 'content'
  | 'error'
  | 'sent_at'
>;

export async function MessageLog({
  entries,
  debtorNames,
}: {
  entries: ReadonlyArray<MessageLogEntry>;
  /**
   * Names to show per row. Omitted on a customer's own page, where every row is
   * that customer and repeating the name down the column says nothing.
   */
  debtorNames?: Map<string, string>;
}) {
  const t = await getDictionary();

  const statusLabel: Record<CommStatus, string> = {
    sent: t.logs.statusSent,
    failed: t.logs.statusFailed,
    skipped: t.logs.statusSkipped,
  };

  // One list of step names, shared with the scenario editor and the invoice
  // view. Three copies of it drifted apart the moment a fourth rung existed.
  const stepShort = shortStepLabels(t);

  return (
    <ul className="divide-y divide-ink-100">
      {entries.map((entry) => {
        // An SMS has no subject, so the first line of the message stands in as
        // the title. Without it a collapsed SMS row would identify itself by
        // nothing at all — a date and a badge, and no way to tell one from the
        // next without opening every one.
        const title = entry.subject?.trim() || firstLine(entry.content);

        return (
          <li key={entry.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {debtorNames ? (
                  <span className="font-medium text-ink-900">
                    {debtorNames.get(entry.debtor_id) ?? t.common.unknownCustomer}
                  </span>
                ) : null}
                <Badge tone={entry.channel === 'sms' ? 'info' : 'neutral'}>
                  {entry.channel === 'sms' ? t.common.sms : t.common.email}
                </Badge>
                {/*
                  A manual reminder carries no step. That is not missing data: it
                  is a contact rather than a rung on the ladder, and labelling it
                  as one would misstate the escalation history.
                */}
                {entry.step ? <Badge tone="neutral">{stepShort[entry.step]}</Badge> : null}
                <Badge tone={STATUS_TONE[entry.status]}>{statusLabel[entry.status]}</Badge>
              </div>
              <time className="tabular text-xs text-ink-500" dateTime={entry.sent_at}>
                {new Date(entry.sent_at).toLocaleString(t.dateTimeTag)}
              </time>
            </div>

            {/* An address has no spaces to break at, so without this it decides
                the width of the card and pushes the page sideways. */}
            <p className="tabular mt-1 break-all text-xs text-ink-500">{entry.recipient}</p>

            {title ? (
              <p className="mt-2 truncate text-sm font-medium text-ink-700">{title}</p>
            ) : null}

            {entry.content ? (
              <details className="group mt-0.5">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs text-ink-500 transition hover:text-ink-800 sm:min-h-0 [&::-webkit-details-marker]:hidden">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
                  >
                    <path
                      d="M6 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="group-open:hidden">{t.logs.showMessage}</span>
                  <span className="hidden group-open:inline">{t.logs.hideMessage}</span>
                </summary>

                <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-600">
                  {entry.content}
                </p>
              </details>
            ) : null}

            {/* Never folded. A send that failed is the one thing on this row
                somebody has to act on, and hiding it behind a toggle is how it
                goes unnoticed. */}
            {entry.error ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                {entry.error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The opening line of a message, for a row that has no subject to show. */
function firstLine(content: string | null): string {
  if (!content) return '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }

  return '';
}
