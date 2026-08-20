import { Badge } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import type { CommStatus, CommunicationLogRow, DunningStep } from '@/types/database';

/**
 * The list of messages that went out, as one rendering used everywhere.
 *
 * Extracted when the customer page needed the same list the log page already
 * had. Two renderings of a compliance record would eventually disagree about
 * what a failed send looks like, and the one nobody was watching would be the
 * one that was wrong.
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

  const stepShort: Record<DunningStep, string> = {
    pre_due: t.steps.shortPreDue,
    overdue_2: t.steps.shortOverdue2,
    overdue_10: t.steps.shortOverdue10,
  };

  return (
    <ul className="divide-y divide-ink-100">
      {entries.map((entry) => (
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

          <p className="tabular mt-1 text-xs text-ink-500">{entry.recipient}</p>

          {entry.subject ? (
            <p className="mt-2 text-sm font-medium text-ink-700">{entry.subject}</p>
          ) : null}

          <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{entry.content}</p>

          {entry.error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {entry.error}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
