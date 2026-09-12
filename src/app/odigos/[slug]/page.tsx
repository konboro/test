import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LeftaLogo } from '@/components/logo';
import { ButtonLink, subtleLinkClass } from '@/components/ui';
import { appUrl } from '@/lib/env';
import { findGuide, GUIDES } from '@/lib/guides';
import { LEGAL_ENTITY } from '@/lib/legal';
import { formatDate } from '@/lib/money';

/** Statically known, so each article is rendered once at build rather than per visit. */
export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findGuide((await params).slug);
  if (!guide) return {};

  return {
    title: guide.title,
    description: guide.summary,
    alternates: { canonical: `/odigos/${guide.slug}` },
    openGraph: {
      title: guide.title,
      description: guide.summary,
      type: 'article',
      publishedTime: guide.published,
      url: `/odigos/${guide.slug}`,
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();

  // Marks the page as an article rather than a landing page, which is what lets
  // a result carry a headline and a date instead of a bare snippet.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.summary,
    datePublished: guide.published,
    inLanguage: 'el',
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
      <script
        type="application/ld+json"
        // Built above from our own content; nothing user-supplied reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" aria-label="lefta.app">
            <LeftaLogo />
          </Link>
          <ButtonLink href="/register" variant="brand">
            Δωρεάν δοκιμή
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/odigos" className={`text-sm ${subtleLinkClass}`}>
          ← Οδηγοί
        </Link>

        <article className="mt-4">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
            {guide.title}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-600">{guide.summary}</p>
          <p className="tabular mt-3 text-xs text-ink-400">{formatDate(guide.published)}</p>

          {guide.sections.map((section) => (
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
          <h2 className="text-base font-semibold text-ink-900">
            Το lefta.app κάνει αυτό αυτόματα
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            Παρακολουθεί τα ανεξόφλητα τιμολόγιά σας, στέλνει τις υπενθυμίσεις για λογαριασμό σας και
            δίνει στον πελάτη σύνδεσμο άμεσης πληρωμής. Τα χρήματα πηγαίνουν απευθείας σε εσάς.
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-4">
            Ξεκινήστε δωρεάν
          </ButtonLink>
        </aside>
      </main>
    </div>
  );
}
