'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SettingsTab {
  href: string;
  label: string;
}

/**
 * The settings tab strip.
 *
 * Links rather than state, because each tab is its own route. That is what
 * makes the Stripe and bank round trips able to come back to the card that
 * started them, what keeps find-in-page working over everything on screen, and
 * what stops a visit to change the company name from also fetching the list of
 * Greek banks from the aggregator.
 *
 * Horizontally scrollable below the small breakpoint: five Greek labels do not
 * fit across a phone, and wrapping them onto two rows pushes the content of
 * every settings screen down by a line that says nothing.
 */
export function SettingsTabs({ tabs }: { tabs: readonly SettingsTab[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-ink-200 px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        // The first tab is the index, so it has to match exactly or it would
        // light up on every other tab as well.
        const active =
          tab.href === '/settings' ? pathname === '/settings' : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition ${
              active
                ? 'border-ink-900 font-medium text-ink-900'
                : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
