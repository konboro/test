import Link from 'next/link';

import { Card, subtleLinkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

import { CompanyForm } from './company-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).companies.addTitle };
}
export const dynamic = 'force-dynamic';

/**
 * Add a company to this login.
 *
 * Two fields, because that is all a company needs to exist here — everything
 * else (myDATA, the payment provider, the reminder ladder) belongs to the
 * company once it does, and is filled in from its own settings screen. An
 * accountant onboarding a client should be through this page in ten seconds.
 */
export default async function NewCompanyPage() {
  const t = await getDictionary();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link href="/companies" className={`text-sm ${subtleLinkClass}`}>
        {t.companies.backToList}
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.companies.addTitle}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.companies.addSubtitle}</p>
      </div>

      <Card>
        <div className="p-5">
          <CompanyForm />
        </div>
      </Card>
    </div>
  );
}
