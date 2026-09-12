import { localeOptions } from '@/lib/i18n/dictionaries';
import { getLocale } from '@/lib/i18n';

import { LocaleMenu } from './locale-menu';

/**
 * The language control, for the top bar of both the site and the panel.
 *
 * It reads the current locale itself rather than taking it as a prop. Every
 * caller is a server component that would have had to fetch the same value and
 * thread it through, and a switch that is handed the wrong locale highlights the
 * wrong entry — a bug with no symptom other than looking slightly off.
 *
 * The list comes from the dictionaries, so this file has no opinion about which
 * languages exist and never needs editing to add one.
 */
export async function LocaleSwitch({ className }: { className?: string }) {
  const current = await getLocale();

  return <LocaleMenu current={current} options={localeOptions()} className={className} />;
}
