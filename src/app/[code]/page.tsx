import { notFound } from 'next/navigation';

import { isPayCode } from '@/lib/pay-code';

import { PayView } from '../pay/pay-view';

// A payment page names a debtor and what they owe. `robots.txt` can ask a
// crawler not to fetch it, but not to leave the URL out of an index it heard
// about elsewhere — and the short links live at the domain root, where no
// prefix rule can reach them. This directive is the one that actually holds.
export const metadata = {
  title: 'Εξόφληση παραστατικού',
  robots: { index: false, follow: false },
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
