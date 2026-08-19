import Link from 'next/link';

import { LeftaLogo, LeftaMark } from '@/components/logo';
import { ButtonLink } from '@/components/ui';
import { appUrl } from '@/lib/env';
import { getDictionary } from '@/lib/i18n';

export default async function HomePage() {
  const t = await getDictionary();

  // Structured data, so a result can carry the product name, what it is and
  // who runs it rather than a stripped snippet. Written from the same copy the
  // page shows — a description here that disagrees with the visible one is
  // what search engines treat as cloaking.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'lefta.app',
        description: t.common.appDescription,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: appUrl(),
        inLanguage: ['el', 'en'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      },
      {
        '@type': 'Organization',
        name: 'lefta.app',
        url: appUrl(),
        logo: `${appUrl()}/icon.svg`,
        areaServed: 'GR',
      },
    ],
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        // The value is built above from our own copy; nothing user-supplied
        // reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="sticky top-0 z-40 border-b border-ink-200/90 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <LeftaLogo />
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-ink-600 transition hover:text-ink-900"
            >
              {t.landing.signIn}
            </Link>
            <ButtonLink href="/register" variant="brand">
              {t.landing.freeTrial}
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 text-center sm:py-20">
          <LeftaMark className="mx-auto h-16 w-16 sm:h-20 sm:w-20" />
          <h1 className="mx-auto mt-8 max-w-2xl text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
            {t.landing.heroTitle}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg">
            {t.landing.heroBody}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/register" variant="brand" className="px-5 py-2.5 text-base">
              {t.landing.startFree}
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-5 py-2.5 text-base">
              {t.landing.haveAccount}
            </ButtonLink>
          </div>
        </section>

        <section className="grid gap-5 pb-16 sm:grid-cols-3 sm:pb-20">
          {t.landing.steps.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm"
            >
              <span className="tabular inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <h2 className="mt-4 text-base font-semibold text-ink-900">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink-900">
            {t.landing.whatsIncluded}
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {t.landing.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The single most common question a Greek SME asks about a service like
            this, so it gets its own section rather than a line in the footer. */}
        <section className="mb-16 overflow-hidden rounded-xl border border-brand-100 bg-brand-50 sm:mb-20">
          <div className="p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-ink-900">
              {t.landing.moneyTitle}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-700">
              {t.landing.moneyIntro} <strong className="font-semibold">Stripe</strong>{' '}
              {t.landing.moneyOr} <strong className="font-semibold">Viva.com</strong>{' '}
              {t.landing.moneyRest}
            </p>
          </div>
        </section>

        <section className="mb-16 rounded-xl border border-ink-200 bg-white p-6 sm:mb-20">
          <h2 className="text-sm font-semibold text-ink-900">
            {t.landing.complianceTitle}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            {t.landing.complianceIntro}{' '}
            <strong className="font-semibold text-ink-800">{t.landing.complianceLimit}</strong>
            {t.landing.complianceRest}
          </p>
        </section>

        <section className="mb-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
            {t.landing.closingTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
            {t.landing.closingBody}
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-6 px-5 py-2.5 text-base">
            {t.landing.startFree}
          </ButtonLink>
        </section>
      </main>

      <footer className="border-t border-ink-200 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4">
          <LeftaLogo markClassName="h-6 w-6" textClassName="text-sm" />
          {/* Without a link from here the guides are orphans: nothing on the
              site points at them, so nothing crawls them. */}
          <Link href="/odigos" className="text-xs text-ink-500 transition hover:text-ink-800">
            Οδηγοί
          </Link>
          <p className="text-xs text-ink-500">© {new Date().getFullYear()} lefta.app</p>
        </div>
      </footer>
    </div>
  );
}
