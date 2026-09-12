import { notFound } from 'next/navigation';

import { isPayCode } from '@/lib/pay-code';

import { PayView, payMetadata } from '../pay/pay-view';

// Code-shaped or not, the title is resolved the same way — but a mistyped URL
// must not reach the database, so the shape is checked here as well as in the
// page below.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return payMetadata(isPayCode(code) ? code : '');
}

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
