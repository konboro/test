import type { MetadataRoute } from 'next';

import { appUrl } from '@/lib/env';

/**
 * The pages worth indexing, which is a short list on purpose.
 *
 * A sitemap listing sign-in and sign-up pages tells a search engine to spend
 * its crawl on screens with nothing to rank for. The landing page carries the
 * whole proposition; the rest of the product is private.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
