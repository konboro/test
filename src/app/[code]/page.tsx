import { notFound } from 'next/navigation';

import { isPayCode } from '@/lib/pay-code';

import { PayView } from '../pay/pay-view';

export const metadata = {
  title: 'Εξόφληση παραστατικού',
  // This page names a debtor and what they owe. Indexed, it would publish a
  // private debt to anyone searching that person's name — and `nocache` keeps
  // it out of the cached copy a delisting would otherwise leave behind.
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = 'force-dynamic';

/**
 * The short payment link: `lefta.app/<code>`.
 *
 * This is the catch-all at the domain root, so it also receives every mistyped
 * URL. Next.js resolves static segments first, so the app's own pages are never
 * routed here; anything that does arrive and is not code-shaped is rejected
 * before it reaches the database.
 */
export default async function ShortPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { code } = await params;
  if (!isPayCode(code)) notFound();

  const { paid } = await searchParams;

  return <PayView credential={code} paid={paid === '1'} />;
}
