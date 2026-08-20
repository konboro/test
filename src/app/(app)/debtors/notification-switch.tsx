'use client';

import { useFormStatus } from 'react-dom';

import { Switch } from '@/components/switch';
import { useT } from '@/lib/i18n/provider';

import { toggleMute } from './actions';

/**
 * Automatic notifications for one customer.
 *
 * Shows the state the operator cares about rather than the one the column is
 * named after: `muted` is stored, but "on" reads as notifications running. A
 * green switch meaning "silenced" would be read wrong by everyone, every time.
 *
 * No confirmation, unlike the tenant-wide switch in settings. That one starts
 * the engine for the whole book; this one is a single customer, and either
 * direction is undone by pressing it again.
 */
function Control({ muted }: { muted: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Switch
      on={!muted}
      label={t.debtors.notificationsLabel}
      size="sm"
      disabled={pending}
    />
  );
}

export function NotificationSwitch({
  debtorId,
  muted,
  withLabel = false,
}: {
  debtorId: string;
  muted: boolean;
  /** Adds the on/off word beside the switch, where there is room for it. */
  withLabel?: boolean;
}) {
  const t = useT();

  return (
    <form action={toggleMute} className="text-right">
      <input type="hidden" name="id" value={debtorId} />
      {/* What is currently stored, so the action flips what the operator saw. */}
      <input type="hidden" name="muted" value={String(muted)} />

      {/*
        Named, like every other value in the row. A bare switch beside an
        amount and a date is the one control on the screen that does not say
        what it governs, and the guess an operator makes about it — mute this
        customer? mute everyone? — is the one they get wrong.
      */}
      <p className="text-xs uppercase tracking-wide text-ink-400">
        {t.debtors.notificationsCaption}
      </p>
      <div className="mt-1 flex items-center justify-end gap-2">
        <Control muted={muted} />
        {withLabel ? <Label muted={muted} /> : null}
      </div>
    </form>
  );
}

function Label({ muted }: { muted: boolean }) {
  const t = useT();

  return (
    <span className={`text-xs font-medium ${muted ? 'text-ink-500' : 'text-emerald-700'}`}>
      {muted ? t.debtors.notificationsOff : t.debtors.notificationsOn}
    </span>
  );
}
