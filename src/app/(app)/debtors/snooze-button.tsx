'use client';

import { useState } from 'react';

import { Modal } from '@/components/modal';
import { Button, Field, inputClass, subtleLinkClass } from '@/components/ui';
import { SNOOZE_PRESETS } from '@/lib/dunning/snooze';
import { useT } from '@/lib/i18n/provider';

import { snoozeDebtor } from './actions';

/**
 * "I'll pay on the 15th" — held for this customer until the date passes.
 *
 * Presets first, because the answer is usually a round number of days and
 * typing a date is slower than pressing "14 days". The exact date stays
 * available for the promise that names one.
 *
 * The control reads as state rather than as a button: when a snooze is running
 * it says until when, and the same dialog offers to lift it — which is how an
 * operator changes their mind without hunting for a different screen.
 */
export function SnoozeButton({
  debtorId,
  snoozedUntil,
  display,
}: {
  debtorId: string;
  snoozedUntil: string | null;
  /** Already formatted for the tenant's locale by the server. */
  display: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = Boolean(snoozedUntil);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm ${subtleLinkClass}`}
        title={t.snooze.hint}
      >
        {active && display ? t.snooze.activeUntil(display) : t.snooze.action}
      </button>

      {open ? (
        <Modal title={t.snooze.title} subtitle={t.snooze.subtitle} onClose={() => setOpen(false)}>
          <form action={snoozeDebtor} className="space-y-4" onSubmit={() => setOpen(false)}>
            <input type="hidden" name="id" value={debtorId} />

            <div className="flex flex-wrap gap-2">
              {SNOOZE_PRESETS.map((days) => (
                <Button key={days} type="submit" name="days" value={days} variant="secondary">
                  {t.snooze.days(days)}
                </Button>
              ))}
            </div>

            <Field label={t.snooze.untilLabel} hint={t.snooze.untilHint}>
              <input
                type="date"
                name="until"
                min={new Date().toISOString().slice(0, 10)}
                defaultValue={snoozedUntil ?? ''}
                className={inputClass}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
              <Button type="submit">{t.snooze.save}</Button>
              {active ? (
                // Same action, no date: lifting a snooze cannot drift from
                // setting one, because there is only one code path.
                <Button type="submit" name="days" value="" variant="secondary">
                  {t.snooze.resume}
                </Button>
              ) : null}
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
