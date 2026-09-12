'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface Tab {
  href: string;
  label: string;
}

/**
 * A row of tabs over sibling routes.
 *
 * Links rather than state, because each tab is its own page. That is what lets
 * a Stripe or a bank round trip come back to the card that started it, what
 * keeps find-in-page working over everything on screen, and what stops a visit
 * to one tab loading the data of the other four.
 *
 * Horizontally scrollable below the small breakpoint: five Greek labels do not
 * fit across a phone, and wrapping them onto two rows pushes the content of
 * every screen down by a line that says nothing.
 */
export function TabStrip({
  tabs,
  label,
  /**
   * Which tab is the section's index, matched exactly rather than by prefix.
   * Without it the first tab lights up on every other tab as well, since every
   * sibling path starts with it.
   */
  indexHref,
}: {
  tabs: readonly Tab[];
  label: string;
  indexHref?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-ink-200 px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === indexHref ? pathname === tab.href : pathname.startsWith(tab.href);

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
