'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { DICTIONARIES, type Dictionary, type Locale } from './dictionaries';

/**
 * Makes the dictionary available to client components.
 *
 * Only the locale *string* crosses the server/client boundary. The dictionary
 * itself cannot: several entries are functions (pluralisation, interpolation),
 * and functions are not serialisable in React's payload. So the provider carries
 * `'el' | 'en'` and each client component looks the strings up from the module
 * it imports directly.
 *
 * The cost is that both languages ship in the client bundle. They are a few
 * kilobytes of text, which is cheaper than threading a dictionary prop through
 * every form in the app and much harder to get wrong.
 */
const LocaleContext = createContext<Locale>('el');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useT(): Dictionary {
  return DICTIONARIES[useContext(LocaleContext)];
}

/**
 * The active language itself, not its dictionary.
 *
 * For the handful of controls that have to mark which language is current
 * rather than read a string in it.
 */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
