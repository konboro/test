import { redirect } from 'next/navigation';

import { MessageLog } from '@/components/message-log';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata() {
  return { title: (await getDictionary()).logs.title };
}
export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  const t = await getDictionary();
  const supabase = await createClient();

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
          <MessageLog entries={logs} debtorNames={debtorsById} />
        )}
      </Card>
    </div>
  );
}
