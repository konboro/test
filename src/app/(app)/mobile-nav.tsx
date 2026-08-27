'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/provider';

/**
 * The navigation a phone actually gets.
 *
 * It replaces a strip of seven tabs that scrolled sideways under the header —
 * which meant the destination you wanted was often off-screen, and nothing told
 * you it was there. A fixed bar at the bottom shows the four screens this
 * product is used from, in the place a thumb already rests, and puts the rest
 * behind one more tap.
 *
 * Four and a fifth, not five: a "more" button that is itself a destination
 * would leave no room for the label, and an unlabelled icon in a bar of labelled
 * ones reads as broken rather than clever.
 */

export interface NavItem {
  href: string;
  label: string;
}

/** Which of the navigation entries earn a place in the bar, in order. */
const PRIMARY = ['/dashboard', '/invoices', '/debtors', '/bank'];

function Icon({ href, className }: { href: string; className: string }) {
  // Stroked, 1.75, no fill: at 22px a filled glyph turns into a blob, and the
  // active state is carried by colour rather than by weight.
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (href === '/dashboard') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    );
  }

  if (href === '/invoices') {
    return (
      <svg {...common}>
        <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v6h6" />
        <path d="M9 14h7M9 17.5h4" />
      </svg>
    );
  }

  if (href === '/debtors') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.25" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-2-4.2" />
      </svg>
    );
  }

  if (href === '/bank') {
    return (
      <svg {...common}>
        <path d="M3 9.5 12 4l9 5.5" />
        <path d="M5 10v8M10 10v8M14 10v8M19 10v8" />
        <path d="M3 20.5h18" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

export function MobileNav({ items }: { items: ReadonlyArray<NavItem> }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Any navigation closes the sheet. Without this it survives the transition
  // and covers the page it just sent you to.
  useEffect(() => setOpen(false), [pathname]);

  const primary = PRIMARY.map((href) => items.find((item) => item.href === href)).filter(
    (item): item is NavItem => Boolean(item),
  );
  const rest = items.filter((item) => !PRIMARY.includes(item.href));

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const restActive = rest.some((item) => active(item.href));

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-ink-900/20 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Sits above the bar rather than over it, so the button that opened it
          stays visible and can close it again. */}
      {open && rest.length ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 border-t border-ink-200 bg-white px-2 pb-2 pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:hidden">
          {rest.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-12 items-center rounded-lg px-3 text-sm font-medium ${
                active(item.href) ? 'bg-brand-50 text-brand-700' : 'text-ink-700'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label={t.nav.primary}
      >
        <div className="mx-auto flex h-16 max-w-lg items-stretch">
          {primary.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
                active(item.href) ? 'text-brand-600' : 'text-ink-500'
              }`}
            >
              <Icon href={item.href} className="h-[22px] w-[22px]" />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          ))}

          {rest.length ? (
            <button
              type="button"
              onClick={() => setOpen((was) => !was)}
              aria-expanded={open}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
                open || restActive ? 'text-brand-600' : 'text-ink-500'
              }`}
            >
              <Icon href="__more" className="h-[22px] w-[22px]" />
              <span className="max-w-full truncate px-1">{t.nav.more}</span>
            </button>
          ) : null}
        </div>
      </nav>
    </>
  );
}
