import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { PublicFooter } from '@/components/public-chrome';
import { ButtonLink } from '@/components/ui';
import { getDictionary, getLocale } from '@/lib/i18n';
import { LEGAL, type LegalDocument } from '@/lib/legal';
import { formatDate } from '@/lib/money';

/**
 * Both legal documents share one rendering.
 *
 * They are the same shape — a title, a date and a run of headed sections — and
 * two copies of this layout would drift in exactly the way legal pages must not.
 */
export async function LegalPage({ pick }: { pick: (l: (typeof LEGAL)['el']) => LegalDocument }) {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const doc = pick(LEGAL[locale]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" aria-label="lefta.app">
            <LeftaLogo />
          </Link>
          <ButtonLink href="/register" variant="brand">
            {t.landing.startFree}
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900">
          {doc.title}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-600">{doc.summary}</p>
        {/* A policy with no date tells the reader nothing about whether it still
            describes the product they are using. */}
        <p className="tabular mt-3 text-xs text-ink-400">{formatDate(doc.updated)}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight text-ink-900">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="mt-3 leading-relaxed text-ink-700">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
