'use client';

import { useState } from 'react';

import { Modal } from '@/components/modal';
import { Button, Field, inputClass, subtleLinkClass } from '@/components/ui';
import { MAX_SNOOZE_NOTE, SNOOZE_PRESETS } from '@/lib/dunning/snooze';
import { useT } from '@/lib/i18n/provider';

import { snoozeDebtor } from './actions';

/**
 * "I'll pay on the 15th" — held for this customer until the date passes.
 *
 * Presets first, because the answer is usually a round number of days and
 * typing a date is slower than pressing "14 days". The exact date stays
 * available for the promise that names one.
 *
 * The button no longer spells out the state: the row shows the end date in its
 * own labelled block, next to the amount, and a control that repeated it was
 * saying the same thing twice in the space where the next action belongs. What
 * it does say is which of the two things a click will do — start a pause, or
 * change the one that is running.
 */
export function SnoozeButton({
  debtorId,
  snoozedUntil,
  note,
}: {
  debtorId: string;
  snoozedUntil: string | null;
  note: string | null;
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
        {active ? t.snooze.change : t.snooze.action}
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

            {/*
              Why, in the operator's own words. A pause read two weeks later is
              a date and nothing else — whether the customer promised a
              transfer, asked for instalments or is disputing the invoice is
              exactly what the next person needs, and often is not the person
              who made the promise.

              Outside the date field so it rides along with the presets too:
              the fast path is "14 days" plus a sentence, not a typed date.
            */}
            <Field label={t.snooze.noteLabel} hint={t.snooze.noteHint}>
              <input
                type="text"
                name="note"
                maxLength={MAX_SNOOZE_NOTE}
                defaultValue={note ?? ''}
                placeholder={t.snooze.notePlaceholder}
                className={inputClass}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
              <Button type="submit">{t.snooze.save}</Button>
              {active ? (
                // Its own field rather than an empty `days`: the date input
                // posts its value with every button, and "resume" that carries
                // yesterday's promise along re-saves the promise.
                <Button type="submit" name="resume" value="1" variant="secondary">
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
