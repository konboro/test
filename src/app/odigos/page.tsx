import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { GUIDES, guideCopy } from '@/lib/guides';
import { getDictionary, getLocale } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();

  return {
    title: t.guides.metaTitle,
    description: t.guides.metaDescription,
    alternates: { canonical: '/odigos' },
  };
}

/**
 * The guide index.
 *
 * It used to carry its own header, its own Greek headings and its own call to
 * action, which made it the one public section that could not be read in
 * English — while the top bar linked to it from both languages. It now uses the
 * same chrome as every other public page, which also means it has the language
 * menu: a visitor arriving here from a search result has somewhere to change it.
 */
export default async function GuidesPage() {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);

  return (
    <div className="min-h-screen">
      <PublicHeader t={t} />

      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          {t.guides.metaTitle}
        </h1>
        <p className="mt-2 text-base leading-relaxed text-ink-600">{t.guides.intro}</p>

        <ul className="mt-10 space-y-6">
          {GUIDES.map((guide) => {
            const copy = guideCopy(guide, locale);

            return (
              <li
                key={guide.slug}
                className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm"
              >
                <h2 className="text-lg font-semibold text-ink-900">
                  <Link href={`/odigos/${guide.slug}`} className="hover:text-brand-600">
                    {copy.title}
                  </Link>
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{copy.summary}</p>
              </li>
            );
          })}
        </ul>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
