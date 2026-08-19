import Link from 'next/link';
import { redirect } from 'next/navigation';

import { subtleLinkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

import { ImportForm } from './import-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).importer.title };
}

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const t = await getDictionary();
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
          ← {t.importer.back}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">{t.importer.title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">
          {t.importer.subtitle}
        </p>
      </div>

      <ImportForm termDays={profile?.default_payment_terms_days ?? 0} />
    </div>
  );
}
