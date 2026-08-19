import { PayView } from '../pay-view';

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
 * Long-form payment link, kept for reminders sent before short links existed.
 * New reminders point at `lefta.app/<code>`; this route must never be retired,
 * because the links it serves are already in debtors' inboxes.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token } = await params;
  const { paid } = await searchParams;

  return <PayView credential={token} paid={paid === '1'} />;
}
