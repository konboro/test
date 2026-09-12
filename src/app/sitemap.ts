import type { MetadataRoute } from 'next';

import { appUrl } from '@/lib/env';
import { GUIDES } from '@/lib/guides';

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
    // Two pages that answer a question before anyone signs up: what it costs,
    // and who ends up holding the money. Both rank for terms the landing page
    // cannot, because the landing page is about the product rather than about
    // the question.
    {
      url: `${base}/pricing`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    },
    {
      url: `${base}/faq`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    },
    // Listed, but at the bottom of the priority list. Nobody searches for these;
    // they are here so that a crawler can confirm they exist and a reader can
    // find them without hunting.
    {
      url: `${base}/aporrito`,
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
    {
      url: `${base}/oroi`,
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    },
    {
      url: `${base}/odigos`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    },
    // The articles are what can rank for a question someone actually typed;
    // the landing page only ever ranks for the product name.
    ...GUIDES.map((guide) => ({
      url: `${base}/odigos/${guide.slug}`,
      lastModified: new Date(guide.published),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
