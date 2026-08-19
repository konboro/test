import { DICTIONARIES } from '@/lib/i18n/dictionaries';
import { switchLocale } from '@/lib/i18n/actions';
import { getLocale, LOCALES } from '@/lib/i18n';

/**
 * The language control, for the top bar of both the site and the panel.
 *
 * It reads the current locale itself rather than taking it as a prop. Every
 * caller is a server component that would have had to fetch the same value and
 * thread it through, and a switch that is handed the wrong locale highlights the
 * wrong half of itself — a bug with no symptom other than looking slightly off.
 *
 * Two submit buttons in a plain form, so it works before any JavaScript arrives.
 * A `<select>` would need a client component to submit on change, which is a
 * lot of machinery for a choice between two words.
 */
export async function LocaleSwitch({ className }: { className?: string }) {
  const current = await getLocale();

  return (
    <form
      action={switchLocale}
      className={`flex items-center gap-0.5 rounded-lg border border-ink-200 p-0.5 ${className ?? ''}`}
    >
      {LOCALES.map((code) => {
        const active = code === current;

        return (
          <button
            key={code}
            type="submit"
            name="locale"
            value={code}
            // `aria-current` rather than a disabled button: pressing the active
            // language should be a harmless no-op, not a dead control that a
            // screen reader skips over entirely.
            aria-current={active ? 'true' : undefined}
            title={DICTIONARIES[code].languageName}
            className={`rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition ${
              active ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
            }`}
          >
            {code}
          </button>
        );
      })}
    </form>
  );
}
