import type { MetadataRoute } from 'next';

import { appUrl } from '@/lib/env';

/**
 * The pages worth crawling: three, and only three.
 *
 * Everything else behind the login is gated by the middleware and would answer a
 * crawler with a redirect, and the payment pages must never be listed — each one
 * carries a named debtor and an amount. Listing only what is genuinely public
 * also means a URL appearing here later is a decision somebody made, not a route
 * that leaked in.
 *
 * `lastModified` is deliberately absent. It would have to be either the moment
 * of the request, which tells a crawler the page changes constantly and is a
 * lie, or a hardcoded date that goes stale the next time the copy is edited.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();

  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/faq`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
