import { PayView } from '../pay-view';

export const metadata = { title: 'Εξόφληση παραστατικού' };
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
