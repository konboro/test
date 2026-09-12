import type { MetadataRoute } from 'next';

import { appUrl } from '@/lib/env';

/**
 * What a crawler may look at.
 *
 * Only the landing page is public in any meaningful sense. Everything else is
 * either behind a session or, in the case of a payment link, a page that names a
 * debtor and what they owe — indexing one of those would publish a private debt
 * to anyone who searched for the person's name.
 *
 * The payment pages are also `noindex` in their own metadata. Both, deliberately:
 * robots.txt asks a crawler not to fetch, the meta tag tells one that fetched it
 * anyway not to keep it, and a link shared into a chat app is fetched by
 * something that reads neither convention.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/invoices',
          '/debtors',
          '/bank',
          '/logs',
          '/settings',
          '/pay/',
          '/api/',
        ],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
    host: appUrl(),
  };
}
