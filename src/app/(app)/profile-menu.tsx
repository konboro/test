'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { signOut } from '@/app/auth/actions';
import { LocaleMenu } from '@/components/locale-menu';
import { localeOptions } from '@/lib/i18n/dictionaries';
import { useLocale, useT } from '@/lib/i18n/provider';

/**
 * The account menu, in place of a sign-out button sitting in the bar.
 *
 * Signing out was the loudest control in the header and the one used least. What
 * belongs there instead is everything about the account: who you are signed in
 * as, the one thing in this product that costs money, the way to the settings,
 * and — last, and quietly — the way out.
 *
 * There is deliberately no plan or upgrade here. lefta.app has no subscription:
 * the pricing page says so in as many words, email reminders are unlimited and
 * free, and the only thing money is ever spent on is SMS credits. An "upgrade"
 * entry would advertise a purchase that does not exist, so what stands in its
 * place is the real balance and the real way to top it up.
 */
export function ProfileMenu({
  companyName,
  email,
  smsCredits,
  showCredits,
}: {
  companyName: string | null;
  email: string | null;
  smsCredits: number;
  /** Credits are only worth showing where they are actually metered. */
  showCredits: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const locale = useLocale();
  const label = companyName ?? email ?? t.nav.account;
  const initial = (companyName ?? email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.nav.account}
        className="flex items-center gap-2 rounded-lg border border-ink-300 px-2 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[14ch] truncate lg:block">{label}</span>
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-ink-400">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg"
        >
          <div className="border-b border-ink-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-ink-900">{label}</p>
            {email && email !== label ? (
              <p className="truncate text-xs text-ink-500">{email}</p>
            ) : null}
          </div>

          {showCredits ? (
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
              <span className="text-xs text-ink-500">{t.nav.smsCredits}</span>
              <span className="flex items-center gap-2">
                <span className="tabular text-sm font-semibold text-ink-900">{smsCredits}</span>
                <Link
                  href="/settings#credits"
                  onClick={() => setOpen(false)}
                  className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  {t.nav.topUpSms}
                </Link>
              </span>
            </div>
          ) : null}

          <div className="px-2 py-2">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-lg px-2 text-sm text-ink-700 transition hover:bg-ink-50"
            >
              {t.nav.settings}
            </Link>
          </div>

          {/* The top bar has room for the language switch from the small
              breakpoint up; on a phone it does not, and a control that exists
              only on desktop is a control a phone user cannot reach. The action
              is the same one, so both places behave identically. */}
          <div className="border-t border-ink-100 px-2 py-2 sm:hidden">
            <LocaleMenu current={locale} options={localeOptions()} panel="inline" />
          </div>

          <div className="flex items-center justify-end border-t border-ink-100 px-4 py-3">
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm text-ink-500 underline-offset-2 transition hover:text-red-600 hover:underline"
              >
                {t.common.signOut}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
