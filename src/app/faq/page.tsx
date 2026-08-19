import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd, PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, linkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();

  return {
    title: t.faq.metaTitle,
    description: t.faq.metaDescription,
    alternates: { canonical: '/faq' },
    openGraph: {
      title: `${t.faq.metaTitle} — lefta.app`,
      description: t.faq.metaDescription,
      url: '/faq',
      type: 'website',
    },
  };
}

/**
 * The questions a Greek business asks before it starts.
 *
 * Every answer is rendered in full rather than behind an accordion. The
 * structured data below is generated from the same array, and Google only
 * honours a FAQPage whose answers are actually on the page — building the
 * markup from the copy rather than beside it is what keeps that true after the
 * next edit.
 */
export default async function FaqPage() {
  const t = await getDictionary();

  return (
    <div className="min-h-screen">
      <PublicHeader t={t} />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: t.faq.items.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        }}
      />

      <main className="mx-auto max-w-3xl px-4">
        <section className="py-16 sm:py-20">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
            {t.faq.title}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-600">
            {t.faq.subtitle}
          </p>
        </section>

        <section className="pb-14">
          <dl className="divide-y divide-ink-200 border-y border-ink-200">
            {t.faq.items.map((item) => (
              <div key={item.q} className="py-6">
                <dt className="text-base font-semibold text-ink-900">
                  {/* An h2 inside the term keeps the outline readable — a
                      question is a heading, whatever list it sits in. */}
                  <h2>{item.q}</h2>
                </dt>
                <dd className="mt-2.5 text-sm leading-relaxed text-ink-600">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mb-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
            {t.faq.stillTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
            {t.faq.stillBody}
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-6 px-5 py-2.5 text-base">
            {t.landing.startFree}
          </ButtonLink>
          <p className="mt-5 text-sm">
            <Link href="/pricing" className={linkClass}>
              {t.faq.pricingLink}
            </Link>
          </p>
        </section>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
