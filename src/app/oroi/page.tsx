import { LegalPage } from '@/components/legal-page';
import { getLocale } from '@/lib/i18n';
import { LEGAL } from '@/lib/legal';

export async function generateMetadata() {
  const doc = LEGAL[await getLocale()].terms;
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: '/oroi' },
  };
}

export default async function TermsPage() {
  return <LegalPage pick={(l) => l.terms} />;
}
