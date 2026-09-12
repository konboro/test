import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd, PublicFooter, PublicHeader } from '@/components/public-chrome';
import { ButtonLink, linkClass } from '@/components/ui';
import { appUrl } from '@/lib/env';
import { getDictionary } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { SMS_PACKS } from '@/lib/stripe';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();

  return {
    title: t.pricing.metaTitle,
    description: t.pricing.metaDescription,
    alternates: { canonical: '/pricing' },
    openGraph: {
      title: `${t.pricing.metaTitle} — lefta.app`,
      description: t.pricing.metaDescription,
      url: '/pricing',
      type: 'website',
    },
  };
}

/**
 * What lefta.app costs.
 *
 * The pack prices are read from `SMS_PACKS`, the same constant the checkout
 * charges against, rather than written out here. A pricing page that disagrees
 * with the till is worse than no pricing page, and the two would have parted
 * company the first time a pack was repriced.
 */
export default async function PricingPage() {
  const t = await getDictionary();

  const packs = SMS_PACKS.map((pack) => ({
    ...pack,
    // The dictionary's own tag, not a match on the locale: a price rendered
    // with the wrong grouping is the one number on this page a visitor will
    // stop at, and every language added would otherwise need remembering here.
    price: formatMoney(pack.amountCents, 'EUR', t.dateTimeTag),
    // Rounded to the cent it is actually billed at rather than to three
    // decimals: a per-message figure nobody is ever charged reads as a trick.
    unit: formatMoney(Math.round(pack.amountCents / pack.credits), 'EUR', t.dateTimeTag),
  }));

  return (
    <div className="min-h-screen">
      <PublicHeader t={t} />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'lefta.app',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: appUrl(),
          description: t.pricing.metaDescription,
          offers: [
            {
              '@type': 'Offer',
              name: t.pricing.planName,
              price: 0,
              priceCurrency: 'EUR',
              description: t.pricing.planHint,
            },
            ...SMS_PACKS.map((pack) => ({
              '@type': 'Offer',
              name: pack.label,
              price: (pack.amountCents / 100).toFixed(2),
              priceCurrency: 'EUR',
            })),
          ],
        }}
      />

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 text-center sm:py-20">
          <h1 className="mx-auto max-w-2xl text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
            {t.pricing.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-600">
            {t.pricing.subtitle}
          </p>
        </section>

        <section className="grid gap-5 pb-14 lg:grid-cols-2">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-6 sm:p-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-700">
              {t.pricing.planName}
            </h2>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="tabular text-4xl font-semibold tracking-tight text-ink-900">
                {t.pricing.planPrice}
              </span>
              <span className="text-sm text-ink-600">{t.pricing.planPeriod}</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-700">{t.pricing.planHint}</p>

            <h3 className="mt-7 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {t.pricing.includedTitle}
            </h3>
            <ul className="mt-3 space-y-2">
              {t.pricing.included.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
                  <span aria-hidden className="mt-0.5 font-semibold text-brand-600">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              {t.pricing.smsTitle}
            </h2>
            <p className="mt-2 text-sm text-ink-600">{t.pricing.smsHint}</p>

            <ul className="mt-6 divide-y divide-ink-100 border-y border-ink-100">
              {packs.map((pack) => (
                <li key={pack.id} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="text-sm font-medium text-ink-900">{pack.label}</span>
                  <span className="text-right">
                    <span className="tabular block text-sm font-semibold text-ink-900">
                      {pack.price}
                    </span>
                    <span className="tabular block text-xs text-ink-500">
                      {t.pricing.smsPerMessage(pack.unit)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-5 text-xs leading-relaxed text-ink-500">{t.pricing.smsNote}</p>
          </div>
        </section>

        <section className="mb-14 rounded-xl border border-ink-200 bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-ink-900">{t.pricing.commissionTitle}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-600">
            {t.pricing.commissionBody}
          </p>
        </section>

        <section className="mb-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
            {t.pricing.ctaTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
            {t.pricing.ctaBody}
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-6 px-5 py-2.5 text-base">
            {t.landing.startFree}
          </ButtonLink>
          <p className="mt-5 text-sm">
            <Link href="/faq" className={linkClass}>
              {t.pricing.faqLink}
            </Link>
          </p>
        </section>
      </main>

      <PublicFooter t={t} />
    </div>
  );
}
