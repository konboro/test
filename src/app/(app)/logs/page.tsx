import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { STEP_SHORT } from '@/lib/dunning/status';
import { createClient } from '@/lib/supabase/server';
import type { CommStatus } from '@/types/database';

export const metadata = { title: 'Ιστορικό επικοινωνίας — lefta.app' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<CommStatus, 'positive' | 'danger' | 'neutral'> = {
  sent: 'positive',
  failed: 'danger',
  skipped: 'neutral',
};

const STATUS_LABEL: Record<CommStatus, string> = {
  sent: 'Στάλθηκε',
  failed: 'Απέτυχε',
  skipped: 'Παραλείφθηκε',
};

export default async function LogsPage() {
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
        <h1 className="text-xl font-semibold text-ink-900">Ιστορικό επικοινωνίας</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Πλήρες, μη τροποποιήσιμο αρχείο κάθε μηνύματος που στάλθηκε για λογαριασμό σας.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Τελευταία 200 μηνύματα"
          subtitle="Κάθε πελάτης λαμβάνει το πολύ μία επαφή ανά ημέρα."
        />

        {!logs?.length ? (
          <EmptyState
            title="Δεν έχει σταλεί κανένα μήνυμα"
            body="Μόλις υπάρξει παραστατικό που πλησιάζει ή ξεπερνά τη λήξη του, η ροή θα ξεκινήσει αυτόματα."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {logs.map((log) => (
              <li key={log.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">
                      {debtorsById.get(log.debtor_id) ?? 'Άγνωστος πελάτης'}
                    </span>
                    <Badge tone={log.channel === 'sms' ? 'info' : 'neutral'}>
                      {log.channel === 'sms' ? 'SMS' : 'Email'}
                    </Badge>
                    {log.step ? <Badge tone="neutral">{STEP_SHORT[log.step]}</Badge> : null}
                    <Badge tone={STATUS_TONE[log.status]}>{STATUS_LABEL[log.status]}</Badge>
                  </div>
                  <time className="tabular text-xs text-ink-500" dateTime={log.sent_at}>
                    {new Date(log.sent_at).toLocaleString('el-GR')}
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
