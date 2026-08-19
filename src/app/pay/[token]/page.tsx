import { PayView } from '../pay-view';

export const metadata = {
  title: 'Εξόφληση παραστατικού',
  // This page names a debtor and what they owe. Indexed, it would publish a
  // private debt to anyone searching that person's name — and `nocache` keeps
  // it out of the cached copy a delisting would otherwise leave behind.
  robots: { index: false, follow: false, nocache: true },
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
