import { NextResponse } from 'next/server';
import { z } from 'zod';

import { channelFromTag, recordFunnelEvent } from '@/lib/funnel/events';
import { PAY_CODE_LENGTH, payCredentialColumn } from '@/lib/pay-code';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  // Either payment credential, same shape rules as /api/pay/start.
  token: z
    .string()
    .min(PAY_CODE_LENGTH)
    .max(128)
    .regex(/^[A-Za-z0-9]+$/),
  // The channel tag the link carried, if any.
  c: z.string().max(8).nullish(),
});

/**
 * The payment page's view beacon.
 *
 * Fired from a client component after hydration — which is the bot filter: link
 * prefetchers fetch the page but rarely execute it, so a beacon is much closer
 * to "a person looked at this" than a server render ever is. It records the
 * `page_view` step of the funnel (docs/funnel-analytics.md) and deliberately
 * nothing else: no IP, no user agent, no cookies.
 *
 * The response is an unconditional 204. The pay page itself already 404s on an
 * unknown credential, but this endpoint must not become a second, quieter
 * oracle for probing tokens.
 */
export async function POST(request: Request) {
  // sendBeacon posts text/plain; .json() parses the bytes regardless.
  const parsed = schema.safeParse(await request.json().catch(() => null));

  if (parsed.success) {
    const { data: invoice } = await createAdminClient()
      .from('invoices')
      .select('id, user_id, debtor_id')
      .eq(payCredentialColumn(parsed.data.token), parsed.data.token)
      .maybeSingle();

    if (invoice) {
      await recordFunnelEvent({
        userId: invoice.user_id,
        invoiceId: invoice.id,
        debtorId: invoice.debtor_id,
        channel: channelFromTag(parsed.data.c),
        event: 'page_view',
      });
    }
  }

  return new NextResponse(null, { status: 204 });
}
