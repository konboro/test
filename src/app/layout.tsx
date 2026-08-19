import type { Metadata, Viewport } from 'next';

import { appUrl } from '@/lib/env';
import { getDictionary, getLocale } from '@/lib/i18n';

import './globals.css';

/**
 * Built per request rather than declared once: the tab title and description
 * are copy like any other, and a static object cannot read the locale.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);

  return {
    // `template` keeps the wordmark in the tab title on every page without each
    // one having to repeat it.
    title: {
      default: t.common.appTitle,
      template: '%s — lefta.app',
    },
    description: t.common.appDescription,
    applicationName: 'lefta.app',

    // Without a base, every canonical and Open Graph URL below resolves
    // relative to nothing and the tags are quietly useless.
    metadataBase: new URL(appUrl()),
    alternates: { canonical: '/' },

    openGraph: {
      title: t.common.appTitle,
      description: t.common.appDescription,
      url: '/',
      siteName: 'lefta.app',
      // The market is Greek; the interface also speaks English.
      locale: locale === 'en' ? 'en_GB' : 'el_GR',
      type: 'website',
    },

    twitter: { card: 'summary_large_image', title: t.common.appTitle, description: t.common.appDescription },

    // Both interface languages answer on the same URL, chosen by the account
    // and a cookie, so they share one canonical rather than splitting rank.
    robots: { index: true, follow: true },
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
