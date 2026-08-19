import type { MetadataRoute } from 'next';

import { appUrl } from '@/lib/env';

/**
 * What a crawler may fetch.
 *
 * The panel routes are listed even though the middleware already redirects an
 * anonymous request to the login page: a crawler that follows the redirect
 * spends its budget discovering nothing, and the login page is not what anyone
 * searching for this product is looking for.
 *
 * The payment pages are a different matter. `/pay/` and the short links at the
 * root each show a named debtor and what they owe, so they are refused here —
 * and, because a disallow only asks a crawler not to fetch a page and does not
 * stop the URL itself being indexed, both routes also carry `noindex` in their
 * own metadata. The short codes cannot be expressed as a prefix at all, which is
 * exactly why the page-level directive is the one doing the real work.
 */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/pay/',
        '/dashboard',
        '/invoices',
        '/debtors',
        '/settings',
        '/logs',
        '/bank',
        '/login',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
