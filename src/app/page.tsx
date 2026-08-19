import Link from 'next/link';

import { LeftaMark } from '@/components/logo';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, linkClass } from '@/components/ui';
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

  const sectionTitle = 'text-center text-2xl font-semibold tracking-tight text-ink-900';
  const card = 'rounded-xl border border-ink-200 bg-white p-6 shadow-sm';

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        // The value is built above from our own copy; nothing user-supplied
        // reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicHeader t={t} />

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 text-center sm:py-20">
          <LeftaMark className="mx-auto h-16 w-16 sm:h-20 sm:w-20" />

          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-brand-700">
            {t.landing.kicker}
          </p>

          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
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

          {/* The three objections that arrive before anyone reads a feature
              list. Answering them next to the button is cheaper than answering
              them on the pricing page nobody scrolled to. */}
          <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-500">
            {t.landing.heroProof.map((claim) => (
              <li key={claim} className="flex items-center gap-1.5">
                <span aria-hidden className="font-semibold text-brand-600">
                  ✓
                </span>
                {claim}
              </li>
            ))}
          </ul>
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className={sectionTitle}>{t.landing.stepsTitle}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {t.landing.steps.map((step, index) => (
              <div key={step.title} className={card}>
                <span className="tabular inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className={sectionTitle}>{t.landing.industriesTitle}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-ink-600">
            {t.landing.industriesBody}
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {t.landing.industries.map((industry, index) => (
              <div
                key={industry.title}
                // The first card is the one the product was built against, and
                // the only one whose claims come from a fleet actually running
                // on this. Marking it is honest emphasis rather than decoration.
                className={
                  index === 0
                    ? 'rounded-xl border border-brand-100 bg-brand-50 p-6'
                    : card
                }
              >
                <h3 className="text-base font-semibold text-ink-900">{industry.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{industry.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className={sectionTitle}>{t.landing.whatsIncluded}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {t.landing.features.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className={sectionTitle}>{t.landing.integrationsTitle}</h2>
          <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {t.landing.integrations.map((item) => (
              <div key={item.title} className="border-t border-ink-200 pt-4">
                <dt className="text-sm font-semibold text-ink-900">{item.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-ink-600">{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mb-16 overflow-hidden rounded-xl border border-brand-100 bg-brand-50 sm:mb-20">
          <div className="p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-ink-900">{t.landing.moneyTitle}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-700">
              {t.landing.moneyIntro} <strong className="font-semibold">Stripe</strong>{' '}
              {t.landing.moneyOr} <strong className="font-semibold">Viva.com</strong>{' '}
              {t.landing.moneyRest}
            </p>
          </div>
        </section>

        <section className="mb-16 rounded-xl border border-ink-200 bg-white p-6 sm:mb-20">
          <h2 className="text-sm font-semibold text-ink-900">{t.landing.complianceTitle}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            {t.landing.complianceIntro}{' '}
            <strong className="font-semibold text-ink-800">{t.landing.complianceLimit}</strong>
            {t.landing.complianceRest}
          </p>
        </section>

        <section className="mb-16 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-200 bg-white p-6 sm:mb-20 sm:p-8">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">{t.landing.pricingTeaserTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
              {t.landing.pricingTeaserBody}
            </p>
          </div>
          <ButtonLink href="/pricing" variant="secondary" className="px-4 py-2">
            {t.landing.pricingTeaserLink}
          </ButtonLink>
        </section>

        <section className="mb-20 text-center">
          <h2 className={sectionTitle}>{t.landing.closingTitle}</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
            {t.landing.closingBody}
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-6 px-5 py-2.5 text-base">
            {t.landing.startFree}
          </ButtonLink>
          <p className="mt-5 text-sm">
            <Link href="/faq" className={linkClass}>
              {t.landing.faqLink}
            </Link>
          </p>
        </section>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
