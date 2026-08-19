import Link from 'next/link';

import { LeftaMark } from '@/components/logo';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
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

  const eyebrow = 'text-xs font-semibold uppercase tracking-widest text-brand-700';
  const heading = 'mt-3 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl';
  const card =
    'rounded-2xl border border-ink-200 bg-white p-6 shadow-sm transition hover:border-ink-300 hover:shadow-md';

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        // The value is built above from our own copy; nothing user-supplied
        // reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicHeader t={t} />

      {/* A single wash of colour behind the fold, so the hero reads as a
          surface rather than as the top of a long white page. Pure gradient:
          an image here would be one more thing to load before the headline. */}
      <div className="relative isolate overflow-hidden bg-gradient-to-b from-brand-50 via-white to-ink-50">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-14rem] h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-100/60 blur-3xl"
        />

        <section className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:py-24">
          <LeftaMark className="mx-auto h-14 w-14 sm:h-16 sm:w-16" />

          <p className={`mt-6 ${eyebrow}`}>{t.landing.kicker}</p>

          <h1 className="mx-auto mt-4 max-w-3xl text-balance text-[2rem] font-semibold leading-[1.1] tracking-tight text-ink-900 sm:text-5xl">
            {t.landing.heroTitle}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-ink-600 sm:text-lg">
            {t.landing.heroBody}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/register" variant="brand" className="px-6 py-3 text-base">
              {t.landing.startFree}
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-6 py-3 text-base">
              {t.landing.haveAccount}
            </ButtonLink>
          </div>

          {/* The three objections that arrive before anyone reads a feature
              list. Answering them beside the button is cheaper than answering
              them on a pricing page nobody scrolled to. */}
          <ul className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-500">
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
      </div>

      <main className="mx-auto max-w-5xl px-4">
        {/* The product in one picture. Everything below explains it; this shows
            it, which is the part a visitor gives us five seconds for. */}
        <section className="py-16 sm:py-20">
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-semibold text-ink-900">{t.landing.timelineTitle}</h2>

            <ol className="mt-7 grid gap-4 sm:grid-cols-4">
              {t.landing.timeline.map((entry, index) => {
                const settled = index === t.landing.timeline.length - 1;

                return (
                  <li key={entry.day} className="relative">
                    {/* The rail runs between the markers rather than through
                        them, and stops before the last one: the sequence ends
                        when the invoice is paid, and a line continuing past it
                        would say the opposite. */}
                    {!settled ? (
                      <span
                        aria-hidden
                        className="absolute left-3 top-3 hidden h-px w-full bg-ink-200 sm:block"
                      />
                    ) : null}

                    <span
                      aria-hidden
                      className={`relative block h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                        settled ? 'bg-emerald-500' : 'bg-brand-600'
                      }`}
                    />

                    <p className="tabular mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">
                      {entry.day}
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-ink-900">{entry.title}</p>
                    <p className="mt-1 text-xs text-ink-500">{entry.channel}</p>
                  </li>
                );
              })}
            </ol>

            <p className="mt-8 border-t border-ink-100 pt-5 text-sm leading-relaxed text-ink-500">
              {t.landing.timelineNote}
            </p>
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <p className={eyebrow}>{t.landing.eyebrowSteps}</p>
          <h2 className={heading}>{t.landing.stepsTitle}</h2>

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
          <p className={eyebrow}>{t.landing.eyebrowIndustries}</p>
          <h2 className={heading}>{t.landing.industriesTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600">
            {t.landing.industriesBody}
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {t.landing.industries.map((industry, index) => (
              <div
                key={industry.title}
                // The first card is the one the product was built against, and
                // the only one whose claims come from a fleet actually running
                // on this. Marking it is honest emphasis, not decoration.
                className={
                  index === 0
                    ? 'rounded-2xl border border-brand-200 bg-brand-50 p-6 shadow-sm'
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
          <p className={eyebrow}>{t.landing.eyebrowFeatures}</p>
          <h2 className={heading}>{t.landing.whatsIncluded}</h2>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {t.landing.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm transition hover:border-ink-300 hover:shadow-md"
              >
                <h3 className="text-sm font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <p className={eyebrow}>{t.landing.eyebrowIntegrations}</p>
          <h2 className={heading}>{t.landing.integrationsTitle}</h2>

          <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {t.landing.integrations.map((item) => (
              <div key={item.title} className="border-t-2 border-ink-900 pt-4">
                <dt className="text-sm font-semibold text-ink-900">{item.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-ink-600">{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mb-16 overflow-hidden rounded-2xl border border-brand-200 bg-brand-50 sm:mb-20">
          <div className="p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-ink-900">{t.landing.moneyTitle}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-700">
              {t.landing.moneyIntro} <strong className="font-semibold">Stripe</strong>{' '}
              {t.landing.moneyOr} <strong className="font-semibold">Viva.com</strong>{' '}
              {t.landing.moneyRest}
            </p>
          </div>
        </section>

        <section className="mb-16 rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:mb-20 sm:p-8">
          <h2 className="text-sm font-semibold text-ink-900">{t.landing.complianceTitle}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            {t.landing.complianceIntro}{' '}
            <strong className="font-semibold text-ink-800">{t.landing.complianceLimit}</strong>
            {t.landing.complianceRest}
          </p>
        </section>

        <section className="mb-16 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:mb-20 sm:p-8">
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

        <section className="mb-20 rounded-2xl bg-ink-900 px-6 py-14 text-center sm:px-10">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t.landing.closingTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-300">
            {t.landing.closingBody}
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-7 px-6 py-3 text-base">
            {t.landing.startFree}
          </ButtonLink>
          <p className="mt-5 text-sm">
            {/* Not `linkClass`: it paints brand-600, which against ink-900
                lands around 2.6:1 and fails the contrast floor outright. */}
            <Link
              href="/faq"
              className="font-medium text-ink-300 underline-offset-2 transition hover:text-white hover:underline"
            >
              {t.landing.faqLink}
            </Link>
          </p>
        </section>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
