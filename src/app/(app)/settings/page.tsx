import { redirect } from 'next/navigation';

import { Card, CardHeader } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

import { noProfile, settingsAccess } from './access';
import { ProfileForm } from './settings-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).settings.title };
}
export const dynamic = 'force-dynamic';

/**
 * Who this company is, and where its customers reply.
 *
 * Also the landing place for anything that still points at `/settings` with the
 * query of a round trip that now belongs to another tab. A hash never reaches
 * the server, so `#stripe` on an old bookmark cannot be rescued — but `?stripe=`
 * and `?bank=` can, and those are the ones a payment provider or a bank sends
 * somebody back with.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (typeof params.stripe === 'string') {
    redirect(`/settings/payments?stripe=${encodeURIComponent(params.stripe)}#stripe`);
  }
  if (typeof params.credits === 'string') {
    redirect(`/settings/reminders?credits=${encodeURIComponent(params.credits)}#credits`);
  }
  if (typeof params.bank === 'string') {
    // The bank round trip carries counts as well as an outcome, and a summary
    // that lost them would report a sync that found nothing.
    const carried = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') carried.set(key, value);
    }
    redirect(`/settings/sources?${carried}#bank`);
  }

  const t = await getDictionary();
  const { supabase, org } = await settingsAccess();

  const { data: profile, error } = await supabase
    .from('users')
    .select('company_name, email, vat_number, business_mode, reply_to_email, timezone')
    .eq('id', org.id)
    .maybeSingle();

  if (!profile) noProfile('business', error);

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-500">
        {t.settings.tabIntro.business}
      </p>

      <Card>
        <CardHeader title={t.settings.business} />
        <ProfileForm profile={profile} />
      </Card>
    </div>
  );
}
