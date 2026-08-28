import { redirect } from 'next/navigation';

import { MessageLog } from '@/components/message-log';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { DEFAULT_TIMEZONE, zonedDate } from '@/lib/money';
import { requireOrganization } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata() {
  return { title: (await getDictionary()).logs.title };
}
export const dynamic = 'force-dynamic';

/** How far back the summary looks, matching the dashboard funnel. */
const WINDOW_DAYS = 30;

/** Above this the summary stops being exact and says so rather than misleading. */
const WINDOW_CAP = 5000;

export default async function LogsPage() {
  const t = await getDictionary();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const org = await requireOrganization();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: logs }, { data: debtors }, { data: window }, { data: tenant }] = await Promise.all([
    supabase
      .from('communications_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200),
    supabase.from('debtors').select('id, name'),
    // The summary is counted over its own window rather than over the two
    // hundred rows on screen. Counting what is displayed would quietly turn
    // "sent in thirty days" into "sent in the last two hundred messages" the
    // moment there are more than that.
    supabase
      .from('communications_log')
      .select('debtor_id, channel, status, sent_at')
      .gte('sent_at', since)
      .limit(WINDOW_CAP),
    supabase.from('users').select('timezone').eq('id', org.id).maybeSingle(),
  ]);

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d.name]));

  const rows = window ?? [];
  const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;
  const today = zonedDate(timezone);

  const sent = rows.filter((row) => row.status === 'sent');
  const sentToday = sent.filter((row) => zonedDate(timezone, new Date(row.sent_at)) === today);

  const summary = {
    today: sentToday.length,
    month: sent.length,
    customers: new Set(sent.map((row) => row.debtor_id)).size,
    failed: rows.filter((row) => row.status === 'failed').length,
    email: sent.filter((row) => row.channel === 'email').length,
    sms: sent.filter((row) => row.channel === 'sms').length,
  };

  const tile = (label: string, value: number, hint?: string) => (
    <div className="px-4 py-3 sm:px-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold leading-8 text-ink-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{hint}</p> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.logs.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.logs.subtitle}</p>
      </div>

      {/* What the list below adds up to. The list answers "what did we say to
          this person"; this answers "what has been going out", which is the
          question somebody actually arrives with after a batch. */}
      <Card>
        <CardHeader title={t.logs.overviewTitle} subtitle={t.logs.overviewHint} />

        <div className="grid grid-cols-2 divide-x divide-y divide-ink-100 sm:grid-cols-4 sm:divide-y-0">
          {tile(t.logs.overviewToday, summary.today, t.logs.overviewChannels(summary.email, summary.sms))}
          {tile(t.logs.overviewMonth, summary.month)}
          {tile(t.logs.overviewCustomers, summary.customers, t.logs.overviewCustomersHint)}
          {tile(t.logs.overviewFailed, summary.failed, t.logs.overviewFailedHint)}
        </div>

        {rows.length >= WINDOW_CAP ? (
          <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500 sm:px-5">
            {t.logs.overviewCapped}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t.logs.cardTitle} subtitle={t.logs.cardSubtitle} />

        {!logs?.length ? (
          <EmptyState title={t.logs.emptyTitle} body={t.logs.emptyBody} />
        ) : (
          <MessageLog entries={logs} debtorNames={debtorsById} />
        )}
      </Card>
    </div>
  );
}
