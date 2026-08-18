import Link from 'next/link';
import { redirect } from 'next/navigation';

import { subtleLinkClass } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

import { ImportForm } from './import-form';

export const metadata = { title: 'Import należności' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Only used when a row carries no due date of its own.
  const { data: profile } = await supabase
    .from('users')
    .select('default_payment_terms_days')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/debtors" className={`text-sm ${subtleLinkClass}`}>
          ← Klienci
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Import należności</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Wgraj tabelę z dłużnikami, jeśli Twoje należności nie są w żadnym z podpiętych systemów.
        </p>
      </div>

      <ImportForm termDays={profile?.default_payment_terms_days ?? 0} />
    </div>
  );
}
