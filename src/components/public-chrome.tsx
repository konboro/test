import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { LocaleSwitch } from '@/components/locale-switch';
import { ButtonLink } from '@/components/ui';
import type { Dictionary } from '@/lib/i18n';

/**
 * The frame around every page a stranger — or a crawler — can reach.
 *
 * Extracted from the landing page rather than copied into the new ones. The
 * navigation is the reason: pricing, the FAQ and the guides are only worth
 * publishing if something links to them, and pages that each link to the others
 * are the whole of what internal linking means at this size.
 */

const navLinkClass = 'text-sm font-medium text-ink-600 transition hover:text-ink-900';
const footerLinkClass = 'text-sm text-ink-500 transition hover:text-ink-900';

/** Wide enough for a thumb, and it does not wrap the row it sits in. */
const mobileNavLinkClass =
  'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-sm font-medium text-ink-600 transition hover:text-ink-900';

export function PublicHeader({ t }: { t: Dictionary }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-6 sm:py-4">
        <Link href="/" aria-label="lefta.app" className="shrink-0">
          <LeftaLogo />
        </Link>

        {/* Reading sits next to the wordmark; doing sits on the right. Splitting
            them stops the bar reading as one undifferentiated row of links. */}
        <nav className="hidden items-center gap-6 md:flex">
          <Link href="/pricing" className={navLinkClass}>
            {t.pricing.metaTitle}
          </Link>
          <Link href="/faq" className={navLinkClass}>
            {t.faq.metaTitle}
          </Link>
          <Link href="/odigos" className={navLinkClass}>
            {t.common.guides}
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Kept at every width. A visitor who cannot read the page is the one
              who needs this most, and hiding it on exactly the screens where
              that is most likely defeats the point of having it. */}
          <LocaleSwitch />

          {/* Below `sm` there is no room for two calls to action without the
              button wrapping onto a second line — which is what it was doing.
              Signing in stays one tap away in the footer. */}
          <Link href="/login" className={`hidden sm:inline ${navLinkClass}`}>
            {t.landing.signIn}
          </Link>

          <ButtonLink href="/register" variant="brand">
            {t.landing.freeTrial}
          </ButtonLink>
        </div>
      </div>

      {/* The same three destinations, on the screens the desktop nav is hidden
          on. They were reachable only by scrolling to the footer, which is to
          say: not reachable. A scrolling strip rather than a menu, because
          three links do not need a button to open them. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-ink-200/80 px-4 pb-2 md:hidden">
        <Link href="/pricing" className={`${mobileNavLinkClass}`}>
          {t.pricing.metaTitle}
        </Link>
        <Link href="/faq" className={mobileNavLinkClass}>
          {t.faq.metaTitle}
        </Link>
        <Link href="/odigos" className={mobileNavLinkClass}>
          {t.common.guides}
        </Link>
        <Link href="/login" className={`ml-auto ${mobileNavLinkClass}`}>
          {t.landing.signIn}
        </Link>
      </nav>
    </header>
  );
}

export function PublicFooter({ t }: { t: Dictionary }) {
  return (
    <footer className="mt-8 border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <LeftaLogo markClassName="h-7 w-7" textClassName="text-base" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
              {t.landing.tagline}
            </p>
          </div>

          <nav aria-label={t.landing.footerProduct}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              {t.landing.footerProduct}
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link href="/pricing" className={footerLinkClass}>
                  {t.pricing.metaTitle}
                </Link>
              </li>
              <li>
                <Link href="/faq" className={footerLinkClass}>
                  {t.faq.metaTitle}
                </Link>
              </li>
              <li>
                {/* Nothing else on the site points at the guides, so without
                    this link they are orphans that nothing crawls. */}
                <Link href="/odigos" className={footerLinkClass}>
                  {t.common.guides}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={t.landing.footerAccount}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              {t.landing.footerAccount}
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link href="/login" className={footerLinkClass}>
                  {t.landing.signIn}
                </Link>
              </li>
              <li>
                <Link href="/register" className={footerLinkClass}>
                  {t.landing.register}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-6">
          <p className="text-xs text-ink-400">© {new Date().getFullYear()} lefta.app</p>
          {/* Quiet by design, and in the bottom row rather than in a column of
              its own: nobody comes to the site for these, but the person who
              wants them should not have to hunt. */}
          <nav aria-label={t.legal.footerHeading} className="flex flex-wrap items-center gap-4">
            <Link href="/aporrito" className={footerLinkClass}>
              {t.legal.privacy}
            </Link>
            <Link href="/oroi" className={footerLinkClass}>
              {t.legal.terms}
            </Link>
            <span className="text-xs text-ink-400">{t.landing.market}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/**
 * Structured data, rendered as a script tag.
 *
 * `<` is escaped because a literal `</script>` anywhere inside the payload would
 * close the tag early and drop the rest of the page into the document. Nothing
 * here is user-supplied today, but the escape costs nothing and the day someone
 * interpolates a tenant name into a schema is not the day to remember it.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
