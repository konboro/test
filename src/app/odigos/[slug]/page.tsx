import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd, PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, subtleLinkClass } from '@/components/ui';
import { appUrl } from '@/lib/env';
import { findGuide, guideCopy } from '@/lib/guides';
import { getDictionary, getLocale } from '@/lib/i18n';
import { LEGAL_ENTITY } from '@/lib/legal';
import { formatDate } from '@/lib/money';

/**
 * No `generateStaticParams`.
 *
 * The article is rendered in the reader's language, which comes from a cookie,
 * and a page that reads a cookie cannot be built once ahead of time. Three
 * articles rendered per request cost nothing worth serving half of them in a
 * language the reader did not choose.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const guide = findGuide((await params).slug);
  if (!guide) return {};

  const copy = guideCopy(guide, await getLocale());

  return {
    title: copy.title,
    description: copy.summary,
    alternates: { canonical: `/odigos/${guide.slug}` },
    openGraph: {
      title: copy.title,
      description: copy.summary,
      type: 'article',
      publishedTime: guide.published,
      url: `/odigos/${guide.slug}`,
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();

  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const copy = guideCopy(guide, locale);

  // Marks the page as an article rather than a landing page, which is what lets
  // a result carry a headline and a date instead of a bare snippet. The
  // language is the one actually rendered — it used to assert Greek on every
  // request, including the ones served in English.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: copy.title,
    description: copy.summary,
    datePublished: guide.published,
    inLanguage: locale,
    mainEntityOfPage: `${appUrl()}/odigos/${guide.slug}`,
    author: { '@type': 'Organization', name: 'lefta.app', url: appUrl() },
    publisher: {
      '@type': 'Organization',
      name: 'lefta.app',
      legalName: LEGAL_ENTITY.name,
      url: appUrl(),
    },
  };

  return (
    <div className="min-h-screen">
      <JsonLd data={jsonLd} />

      <PublicHeader t={t} />

      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/odigos" className={`text-sm ${subtleLinkClass}`}>
          {t.guides.back}
        </Link>

        <article className="mt-4">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-600">{copy.summary}</p>
          <p className="tabular mt-3 text-xs text-ink-400">
            {formatDate(guide.published, t.dateTimeTag)}
          </p>

          {copy.sections.map((section) => (
            <section key={section.heading} className="mt-10">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="mt-3 leading-relaxed text-ink-700">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>

        <aside className="mt-14 rounded-xl border border-brand-100 bg-brand-50 p-6">
          <h2 className="text-base font-semibold text-ink-900">{t.guides.ctaTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">{t.guides.ctaBody}</p>
          <ButtonLink href="/register" variant="brand" className="mt-4">
            {t.guides.ctaButton}
          </ButtonLink>
        </aside>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
