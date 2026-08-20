import { LegalPage } from '@/components/legal-page';
import { getLocale } from '@/lib/i18n';
import { LEGAL } from '@/lib/legal';

export async function generateMetadata() {
  const doc = LEGAL[await getLocale()].privacy;
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: '/aporrito' },
  };
}

export default async function PrivacyPage() {
  return <LegalPage pick={(l) => l.privacy} />;
}
