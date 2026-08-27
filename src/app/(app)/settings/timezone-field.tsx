'use client';

import { useEffect, useMemo, useState } from 'react';

import { Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

/**
 * Which timezone this company works in.
 *
 * The browser already knows the answer, so the field offers it rather than
 * asking somebody to find their own city in a list of six hundred. It is
 * offered, not imposed: an accountant in Athens managing a Warsaw client is a
 * real arrangement, and a field that silently followed the laptop would fight
 * them every time they opened it from somewhere else.
 */
export function TimezoneField({ value }: { value: string }) {
  const t = useT();

  // Read after mount: the server has no timezone and rendering one there would
  // produce a hydration mismatch on every load.
  const [detected, setDetected] = useState<string | null>(null);
  const [selected, setSelected] = useState(value);

  useEffect(() => {
    try {
      setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDetected(null);
    }
  }, []);

  const zones = useMemo(() => {
    // `supportedValuesOf` is the full IANA list where it exists. Where it does
    // not, the list is whatever we can be sure of — the current value and the
    // detected one — so the field still works rather than showing nothing.
    const all =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [];

    return [...new Set([value, ...(detected ? [detected] : []), ...all])].sort();
  }, [value, detected]);

  const offer = detected && detected !== selected;

  return (
    <Field label={t.settings.timezone} hint={t.settings.timezoneHint}>
      <select
        name="timezone"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className={inputClass}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      {offer ? (
        <button
          type="button"
          onClick={() => setSelected(detected)}
          className="mt-1.5 min-h-11 text-left text-xs text-brand-700 underline-offset-2 hover:underline"
        >
          {t.settings.timezoneDetected(detected.replace(/_/g, ' '))}
        </button>
      ) : null}
    </Field>
  );
}
