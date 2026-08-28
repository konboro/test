import { Badge, Card, CardHeader } from '@/components/ui';
import type { Dictionary } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/money';
import type { ReportBankHint, ReportDetails, ReportKind } from '@/types/database';

import { confirmPaidReport, dismissReport, resolveReport } from './report-actions';

export interface ReviewableReport {
  id: string;
  kind: ReportKind;
  createdAt: string;
  details: ReportDetails;
  bankMatch: ReportBankHint[] | null;
  invoiceLabel: string;
  invoiceAmountCents: number;
  debtorName: string;
}

/**
 * The review queue: what debtors said on the payment page, waiting for a call.
 *
 * Sits above the invoice list because every row here is actively blocking that
 * list — reminders for these invoices are held until someone decides. The
 * decision is deliberately binary per kind: a payment claim is either true
 * (settle) or not (chasing resumes); a dispute is either handled or dismissed.
 * No parking state, because a queue that can be shelved becomes a shelf.
 */
export function ReportReview({ t, reports }: { t: Dictionary; reports: ReviewableReport[] }) {
  if (!reports.length) return null;

  return (
    <Card>
      <CardHeader title={t.reports.title(reports.length)} subtitle={t.reports.subtitle} />

      <ul className="divide-y divide-ink-100">
        {reports.map((report) => (
          <li key={report.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={report.kind === 'paid_claim' ? 'info' : 'warning'}>
                    {report.kind === 'paid_claim' ? t.reports.kindPaid : t.reports.kindDispute}
                  </Badge>
                  <span className="text-sm font-medium text-ink-900">{report.debtorName}</span>
                  <span className="tabular text-sm text-ink-500">
                    {report.invoiceLabel} · {formatMoney(report.invoiceAmountCents)}
                  </span>
                  <span className="text-xs text-ink-400">
                    {t.reports.filed(formatDate(report.createdAt))}
                  </span>
                </div>

                {report.details.summary ? (
                  <p className="mt-1.5 text-sm text-ink-700">{report.details.summary}</p>
                ) : null}

                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-500">
                  {report.details.claimed_paid_on ? (
                    <span>
                      {t.reports.claimedOn(formatDate(report.details.claimed_paid_on))}
                    </span>
                  ) : null}
                  {report.details.claimed_amount_cents ? (
                    <span className="tabular">
                      {formatMoney(report.details.claimed_amount_cents)}
                    </span>
                  ) : null}
                  {report.details.reference ? <span>{report.details.reference}</span> : null}
                  {report.details.contact ? <span>{report.details.contact}</span> : null}
                </p>

                {report.bankMatch?.length ? (
                  <p className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
                    {t.reports.bankHint}{' '}
                    {report.bankMatch
                      .map(
                        (hint) =>
                          `${formatMoney(hint.amount_cents)} · ${formatDate(hint.booked_on)}${
                            hint.counterparty_name ? ` · ${hint.counterparty_name}` : ''
                          }`,
                      )
                      .join('  |  ')}
                  </p>
                ) : null}
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                {report.kind === 'paid_claim' ? (
                  <form action={confirmPaidReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-700 sm:min-h-0 sm:py-1.5"
                    >
                      {t.reports.confirmPaid}
                    </button>
                  </form>
                ) : (
                  <form action={resolveReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center rounded-lg bg-ink-900 px-3 text-sm font-medium text-white transition hover:bg-ink-700 sm:min-h-0 sm:py-1.5"
                    >
                      {t.reports.markResolved}
                    </button>
                  </form>
                )}

                <form action={dismissReport}>
                  <input type="hidden" name="id" value={report.id} />
                  {/* Quiet on purpose: dismissing restarts the reminders, and a
                      loud button invites doing that before reading. */}
                  <button
                    type="submit"
                    className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm text-ink-600 transition hover:bg-ink-50"
                  >
                    {t.reports.dismiss}
                  </button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
