import { redirect } from 'next/navigation';

import { LeftaLogo } from '@/components/logo';
import { Card } from '@/components/ui';
import { getDictionary, getLocale } from '@/lib/i18n';
import { LocaleProvider } from '@/lib/i18n/provider';
import { createClient } from '@/lib/supabase/server';

import { JoinForm } from './join-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).join.title };
}
export const dynamic = 'force-dynamic';

/**
 * Accepting an invitation into a company.
 *
 * Deliberately outside the application shell: whoever is holding this link may
 * have no company of their own yet, and the shell exists to navigate one. It
 * also cannot say which company invited them — the invite row is invisible
 * until it is accepted, which is the same reason the acceptance itself runs
 * inside the database.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware gates this route already; this is the same answer written
  // twice, and the cheaper of the two to be wrong about.
  if (!user) redirect(`/login?next=/join/${encodeURIComponent(token)}`);

  return (
    <LocaleProvider locale={locale}>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4">
        <LeftaLogo />

        <Card>
          <div className="space-y-4 p-6">
            <div>
              <h1 className="text-xl font-semibold text-ink-900">{t.join.title}</h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">
                {t.join.body(user.email ?? '')}
              </p>
            </div>

            <JoinForm token={token} />

            <p className="text-xs text-ink-500">{t.join.emailNote}</p>
          </div>
        </Card>
      </div>
    </LocaleProvider>
  );
}
