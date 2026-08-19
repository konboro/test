import type { Metadata, Viewport } from 'next';

import { appUrl } from '@/lib/env';
import { getDictionary, getLocale } from '@/lib/i18n';

import './globals.css';

/**
 * Built per request rather than declared once: the tab title and description
 * are copy like any other, and a static object cannot read the locale.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  const locale = await getLocale();

  return {
    // Without a base, every relative canonical and og:url below resolves
    // against nothing and Next drops it. It is the one setting that decides
    // whether the rest of this object reaches a crawler at all.
    metadataBase: new URL(appUrl()),
    // `template` keeps the wordmark in the tab title on every page without each
    // one having to repeat it.
    title: {
      default: t.common.appTitle,
      template: '%s — lefta.app',
    },
    description: t.common.appDescription,
    applicationName: 'lefta.app',
    // Defaults for the public pages; each one narrows the title, description
    // and url to its own. No canonical is set here on purpose — inherited, it
    // would point the login and payment pages at the home page, which is a
    // claim about them that is not true.
    openGraph: {
      type: 'website',
      siteName: 'lefta.app',
      locale: locale === 'el' ? 'el_GR' : 'en_GB',
      title: t.common.appTitle,
      description: t.common.appDescription,
    },
    twitter: {
      card: 'summary',
      title: t.common.appTitle,
      description: t.common.appDescription,
    },
  };
}

export const viewport: Viewport = {
  // Tints the browser chrome on mobile to match the header.
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The document language has to follow the reader, not the market: it drives
  // screen-reader pronunciation and offers to translate the page.
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
