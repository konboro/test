import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import type { CommStatus, DunningStep } from '@/types/database';

export async function generateMetadata() {
  return { title: (await getDictionary()).logs.title };
}
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<CommStatus, 'positive' | 'danger' | 'neutral'> = {
  sent: 'positive',
  failed: 'danger',
  skipped: 'neutral',
};

export default async function LogsPage() {
  const t = await getDictionary();
  const supabase = await createClient();

  const STATUS_LABEL: Record<CommStatus, string> = {
    sent: t.logs.statusSent,
    failed: t.logs.statusFailed,
    skipped: t.logs.statusSkipped,
  };

  const STEP_SHORT: Record<DunningStep, string> = {
    pre_due: t.steps.shortPreDue,
    overdue_2: t.steps.shortOverdue2,
    overdue_10: t.steps.shortOverdue10,
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: logs }, { data: debtors }] = await Promise.all([
    supabase
      .from('communications_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200),
    supabase.from('debtors').select('id, name'),
  ]);

  const debtorsById = new Map((debtors ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.logs.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {t.logs.subtitle}
        </p>
      </div>

      <Card>
        <CardHeader
          title={t.logs.cardTitle}
          subtitle={t.logs.cardSubtitle}
        />

        {!logs?.length ? (
          <EmptyState
            title={t.logs.emptyTitle}
            body={t.logs.emptyBody}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {logs.map((log) => (
              <li key={log.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">
                      {debtorsById.get(log.debtor_id) ?? t.common.unknownCustomer}
                    </span>
                    <Badge tone={log.channel === 'sms' ? 'info' : 'neutral'}>
                      {log.channel === 'sms' ? t.common.sms : t.common.email}
                    </Badge>
                    {log.step ? <Badge tone="neutral">{STEP_SHORT[log.step]}</Badge> : null}
                    <Badge tone={STATUS_TONE[log.status]}>{STATUS_LABEL[log.status]}</Badge>
                  </div>
                  <time className="tabular text-xs text-ink-500" dateTime={log.sent_at}>
                    {new Date(log.sent_at).toLocaleString(t.dateTimeTag)}
                  </time>
                </div>

                <p className="tabular mt-1 text-xs text-ink-500">{log.recipient}</p>

                {log.subject ? (
                  <p className="mt-2 text-sm font-medium text-ink-700">{log.subject}</p>
                ) : null}

                <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{log.content}</p>

                {log.error ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                    {log.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
