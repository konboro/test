import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The middle of the dunning funnel, measured first-party.
 *
 * Sent lives in communications_log and settled lives on the invoice; these
 * helpers cover the two events in between — the payment link being opened and a
 * checkout actually starting — and the channel tag that lets a visit name the
 * message that caused it. Design: docs/funnel-analytics.md.
 */

export type FunnelChannel = 'email' | 'sms' | 'other';
export type FunnelEvent = 'page_view' | 'checkout_started';

/** The query-string value each channel stamps on {{pay_url}}. */
const CHANNEL_TAGS = { email: 'e', sms: 's' } as const;

/**
 * The pay URL a given channel should carry: `…?c=e` for email, `…?c=s` for SMS.
 *
 * Annotation, not routing — the credential resolves identically with or
 * without it. Four characters on the SMS budget, which the template editor's
 * segment counter already makes visible.
 */
export function channelTaggedUrl(payUrl: string, channel: 'email' | 'sms'): string {
  return `${payUrl}${payUrl.includes('?') ? '&' : '?'}c=${CHANNEL_TAGS[channel]}`;
}

/** The tag read back off a visit. Anything unrecognised is an untagged visit. */
export function channelFromTag(tag: string | null | undefined): FunnelChannel {
  if (tag === CHANNEL_TAGS.email) return 'email';
  if (tag === CHANNEL_TAGS.sms) return 'sms';
  return 'other';
}

/**
 * Repeat views of one invoice within this window collapse into one row — a
 * debtor refreshing the page is one visit, not engagement growth. Distinct
 * invoices are what the stats count anyway; this just keeps the table sane.
 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Records one funnel event. Never throws: analytics rides along the money path
 * and must not be able to break it.
 */
export async function recordFunnelEvent(params: {
  userId: string;
  invoiceId: string;
  debtorId?: string | null;
  channel: FunnelChannel;
  event: FunnelEvent;
}): Promise<void> {
  try {
    const admin = createAdminClient();

    const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: recent } = await admin
      .from('funnel_events')
      .select('id')
      .eq('invoice_id', params.invoiceId)
      .eq('event', params.event)
      .eq('channel', params.channel)
      .gte('occurred_at', windowStart)
      .limit(1);

    if (recent?.length) return;

    await admin.from('funnel_events').insert({
      user_id: params.userId,
      invoice_id: params.invoiceId,
      debtor_id: params.debtorId ?? null,
      channel: params.channel,
      event: params.event,
    });
  } catch (cause) {
    console.error('[funnel] recording failed', String(cause));
  }
}
