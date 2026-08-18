import type { Metadata, Viewport } from 'next';

import { getDictionary, getLocale } from '@/lib/i18n';

import './globals.css';

/**
 * Built per request rather than declared once: the tab title and description
 * are copy like any other, and a static object cannot read the locale.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();

  return {
    // `template` keeps the wordmark in the tab title on every page without each
    // one having to repeat it.
    title: {
      default: t.common.appTitle,
      template: '%s — lefta.app',
    },
    description: t.common.appDescription,
    applicationName: 'lefta.app',
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
