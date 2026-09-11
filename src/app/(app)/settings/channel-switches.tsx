'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Switch } from '@/components/switch';
import { useT } from '@/lib/i18n/provider';

import { setChannel, type SettingsState } from './actions';

/**
 * Which channels this account may use at all.
 *
 * One switch each, above the per-step choice in the scenario. A tenant who does
 * not want text messages was previously left editing every rung to take 'sms'
 * out of each one — a per-step answer to a question about the account, and one
 * that says nothing about the rungs they have not configured yet.
 *
 * Each switch is its own form, so one press carries one decision and a failure
 * says which channel it was about.
 */

function Control({
  on,
  label,
  disabled,
}: {
  on: boolean;
  label: string;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return <Switch on={on} label={label} disabled={disabled || pending} />;
}

function ChannelRow({
  channel,
  enabled,
  masterOn,
  available,
  label,
  hint,
}: {
  channel: 'email' | 'sms';
  enabled: boolean;
  masterOn: boolean;
  available: boolean;
  label: string;
  hint: string;
}) {
  const t = useT();
  const [state, action] = useActionState<SettingsState, FormData>(setChannel, {});

  // The master switch is the subject of the sentence: with it off nothing is
  // sent on any channel, so showing these as "on" would be a promise the
  // product does not keep. The stored value is left alone — it comes back as it
  // was when the master goes on again, rather than making somebody set their
  // channels up a second time.
  const effective = masterOn && available && enabled;

  const reason = !masterOn
    ? t.settings.channels.followsMaster
    : !available
      ? t.settings.channels.noProvider
      : null;

  return (
    <form action={action} className="flex items-start justify-between gap-4 py-3">
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />

      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">{reason ?? hint}</p>
        {state.error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {state.error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <Control on={effective} label={label} disabled={!masterOn || !available} />
        <span className={`text-xs font-medium ${effective ? 'text-emerald-700' : 'text-ink-500'}`}>
          {effective ? t.settings.automation.stateOn : t.settings.automation.stateOff}
        </span>
      </div>
    </form>
  );
}

export function ChannelSwitches({
  emailEnabled,
  smsEnabled,
  masterOn,
  emailAvailable,
  smsAvailable,
}: {
  emailEnabled: boolean;
  smsEnabled: boolean;
  /** The account-wide automation switch. Off, these follow it. */
  masterOn: boolean;
  /** Whether a provider is configured at all. Without one the switch is a lie. */
  emailAvailable: boolean;
  smsAvailable: boolean;
}) {
  const t = useT();

  return (
    <div className="divide-y divide-ink-100 px-5 pb-5">
      <ChannelRow
        channel="email"
        enabled={emailEnabled}
        masterOn={masterOn}
        available={emailAvailable}
        label={t.common.email}
        hint={t.settings.channels.emailHint}
      />
      <ChannelRow
        channel="sms"
        enabled={smsEnabled}
        masterOn={masterOn}
        available={smsAvailable}
        label={t.common.sms}
        hint={t.settings.channels.smsHint}
      />
    </div>
  );
}
