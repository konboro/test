import type { CommChannel } from '@/types/database';

/**
 * Whether the account allows a channel at all.
 *
 * Separate from "can this debtor be reached on it" and from "is a provider
 * configured": those are facts about the customer and the environment, this is
 * the operator's own answer, given once in settings and meant to hold for every
 * rung including the ones they have not configured yet.
 *
 * It lives in its own module because all three deciders need it and none of them
 * can import from each other — `engine` imports `dispatch`, so `dispatch` cannot
 * import from `engine`.
 *
 * Undefined reads as a yes. Both columns default true, and a row read before the
 * migration landed carries neither; a missing value must not silently stop every
 * message in the product.
 */

export interface ChannelSwitches {
  email_enabled?: boolean | null;
  sms_enabled?: boolean | null;
}

export function channelSwitchedOn(tenant: ChannelSwitches, channel: CommChannel): boolean {
  return channel === 'email' ? tenant.email_enabled !== false : tenant.sms_enabled !== false;
}

/**
 * The channels of `channels` this account still permits.
 *
 * A veto, never a grant: it only ever removes, so the order the scenario chose
 * survives and switching SMS on at the account level cannot add it to a step
 * that is deliberately email-only.
 */
export function enabledChannels<T extends CommChannel>(
  channels: ReadonlyArray<T>,
  tenant: ChannelSwitches,
): T[] {
  return channels.filter((channel) => channelSwitchedOn(tenant, channel));
}
