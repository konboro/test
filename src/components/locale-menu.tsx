'use client';

import { useEffect, useRef } from 'react';

import { switchLocale } from '@/lib/i18n/actions';
import type { Locale } from '@/lib/i18n/dictionaries';
import { useT } from '@/lib/i18n/provider';

export interface LocaleOption {
  code: Locale;
  /** The name the language calls itself. */
  name: string;
}

/**
 * The language menu.
 *
 * This used to be one button per language sitting in the bar, which is a fine
 * control for two languages and an impossible one for six: the bar has room for
 * about forty pixels of it, and every language added takes another thirty. A
 * menu costs the same width whatever the list length, so adding a language is a
 * dictionary entry and nothing else — no layout to re-think, no breakpoint to
 * re-tune, no decision about which languages are important enough to show.
 *
 * Built on `<details>` rather than on React state, so it still opens and still
 * submits in the window between the HTML arriving and the JavaScript for this
 * page being ready — the window in which somebody who cannot read the page is
 * most likely to be reaching for it. What the JavaScript adds is only the
 * manners a native disclosure lacks: closing when you click elsewhere, closing
 * on Escape, and closing after a choice rather than staying open over the
 * freshly translated page underneath.
 *
 * The trigger shows the code rather than the name because it is two characters
 * in every language, and the bar cannot reflow because somebody chose a language
 * with a long name for itself. The full name is in the menu, and on the trigger
 * as its accessible label.
 */
export function LocaleMenu({
  current,
  options,
  className,
  /** Which edge the panel hangs from. The panel is wider than its trigger. */
  align = 'right',
  /**
   * How the list appears.
   *
   * 'popover' floats it over the page, which is right in a bar. 'inline' opens
   * it in the flow, which is the only thing that works inside another menu:
   * that panel clips its own overflow, so a floating list nested in it would be
   * cut off at the edge — visible enough to look broken, not enough to use.
   */
  panel = 'popover',
}: {
  current: Locale;
  options: readonly LocaleOption[];
  className?: string;
  align?: 'left' | 'right';
  panel?: 'popover' | 'inline';
}) {
  const t = useT();
  const box = useRef<HTMLDetailsElement>(null);
  const currentName = options.find((option) => option.code === current)?.name ?? current;

  useEffect(() => {
    const close = () => {
      if (box.current) box.current.open = false;
    };

    // `mousedown` rather than `click`: a click that starts inside the menu and
    // ends outside it is a drag over the text, not a dismissal.
    const onPointer = (event: MouseEvent) => {
      if (box.current?.open && !box.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details ref={box} className={`group relative ${className ?? ''}`}>
      <summary
        aria-label={`${t.nav.language}: ${currentName}`}
        title={currentName}
        className={`flex cursor-pointer list-none items-center text-ink-700 transition select-none hover:bg-ink-50 [&::-webkit-details-marker]:hidden ${
          panel === 'inline'
            ? 'min-h-11 w-full justify-between gap-3 rounded-lg px-2 text-sm'
            : 'gap-1.5 rounded-lg border border-ink-300 px-2 py-1.5 text-sm'
        }`}
      >
        {panel === 'inline' ? <span className="text-ink-500">{t.nav.language}</span> : null}
        <span className="flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-ink-400">
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM3.5 10c0-.69.09-1.36.27-2h2.9a17 17 0 0 0 0 4h-2.9c-.18-.64-.27-1.31-.27-2Zm4.68 2a15 15 0 0 1 0-4h3.64a15 15 0 0 1 0 4H8.18Zm5.15-4h2.9a6.5 6.5 0 0 1 0 4h-2.9a17 17 0 0 0 0-4Zm2.28-1.5h-2.53a10.7 10.7 0 0 0-1.01-2.84A6.52 6.52 0 0 1 15.61 6.5ZM10 3.67c.5.6.98 1.57 1.29 2.83H8.71c.31-1.26.79-2.23 1.29-2.83ZM7.61 3.66A10.7 10.7 0 0 0 6.6 6.5H4.07a6.52 6.52 0 0 1 3.54-2.84ZM4.07 13.5H6.6c.23 1.08.57 2.04 1.01 2.84a6.52 6.52 0 0 1-3.54-2.84ZM10 16.33c-.5-.6-.98-1.57-1.29-2.83h2.58c-.31 1.26-.79 2.23-1.29 2.83Zm2.39-.99c.44-.8.78-1.76 1.01-2.84h2.53a6.52 6.52 0 0 1-3.54 2.84Z"
            clipRule="evenodd"
          />
        </svg>
        {/* The code in the bar, because it is two characters in every
            language and the bar cannot reflow when somebody picks a language
            with a long name for itself. The name where there is room for it —
            and not upper-cased there, which mangles Greek. */}
        <span
          className={`text-xs font-semibold tracking-wide ${panel === 'inline' ? '' : 'uppercase'}`}
        >
          {panel === 'inline' ? currentName : current}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-ink-400 transition group-open:rotate-180"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
        </span>
      </summary>

      <form
        action={switchLocale}
        className={
          panel === 'inline'
            ? 'mt-1 grid gap-0.5'
            : `absolute z-50 mt-2 min-w-44 overflow-hidden rounded-xl border border-ink-200 bg-white p-1 shadow-lg ${
                align === 'right' ? 'right-0' : 'left-0'
              }`
        }
      >
        {options.map((option) => {
          const active = option.code === current;

          return (
            <button
              key={option.code}
              type="submit"
              name="locale"
              value={option.code}
              // Radio rather than plain items: these are one setting with
              // several values, and a screen reader should say which one is on
              // rather than reading a list of unrelated commands.
              role="menuitemradio"
              aria-checked={active}
              // Closes on the way out. The action reloads the tree underneath,
              // and an open menu over a page that has just changed language
              // reads as though the choice did not take.
              onClick={() => {
                if (box.current) box.current.open = false;
              }}
              className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition ${
                active ? 'bg-ink-50 font-medium text-ink-900' : 'text-ink-700 hover:bg-ink-50'
              }`}
            >
              <span>{option.name}</span>
              <span className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                {option.code}
              </span>
            </button>
          );
        })}
      </form>
    </details>
  );
}
