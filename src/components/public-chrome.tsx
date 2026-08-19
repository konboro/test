import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { ButtonLink } from '@/components/ui';
import type { Dictionary } from '@/lib/i18n';

/**
 * The frame around every page a stranger — or a crawler — can reach.
 *
 * Extracted from the landing page rather than copied into the new ones. The
 * navigation is the reason: pricing and the FAQ are only worth publishing if
 * something links to them, and three pages that each link to the other two is
 * the whole of what internal linking means at this size. Copies would have
 * drifted the first time one of them gained a link.
 */

const navLinkClass = 'text-sm font-medium text-ink-600 transition hover:text-ink-900';
const footerLinkClass = 'text-xs text-ink-500 transition hover:text-ink-800';

export function PublicHeader({ t }: { t: Dictionary }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/90 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" aria-label="lefta.app">
          <LeftaLogo />
        </Link>

        <nav className="flex items-center gap-3 sm:gap-5">
          {/* Hidden on the narrowest screens: at that width the two calls to
              action are what the visitor came for, and four competing links
              read as a menu nobody asked for. Both pages stay one tap away in
              the footer, which is also where a crawler finds them regardless. */}
          <Link href="/pricing" className={`hidden sm:inline ${navLinkClass}`}>
            {t.pricing.metaTitle}
          </Link>
          <Link href="/faq" className={`hidden sm:inline ${navLinkClass}`}>
            {t.faq.metaTitle}
          </Link>
          <Link href="/login" className={navLinkClass}>
            {t.landing.signIn}
          </Link>
          <ButtonLink href="/register" variant="brand">
            {t.landing.freeTrial}
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({ t }: { t: Dictionary }) {
  return (
    <footer className="border-t border-ink-200 py-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4">
        <LeftaLogo markClassName="h-6 w-6" textClassName="text-sm" />

        {/* Every public page is reachable from every other one. The guides in
            particular depend on it: nothing else on the site points at them, so
            without this link they are orphans that nothing crawls. */}
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/pricing" className={footerLinkClass}>
            {t.pricing.metaTitle}
          </Link>
          <Link href="/faq" className={footerLinkClass}>
            {t.faq.metaTitle}
          </Link>
          <Link href="/odigos" className={footerLinkClass}>
            {t.common.guides}
          </Link>
        </nav>

        <p className="text-xs text-ink-500">© {new Date().getFullYear()} lefta.app</p>
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
