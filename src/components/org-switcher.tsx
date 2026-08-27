'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';

import { switchOrganization } from '@/app/(app)/companies/actions';
import { useT } from '@/lib/i18n/provider';
import type { OrgRole } from '@/lib/orgs/roles';

export interface SwitcherOrg {
  id: string;
  name: string | null;
  vatNumber: string | null;
  role: OrgRole;
}

/** How many companies fit in a dropdown before it stops being one. */
const SHOWN = 8;

/**
 * Which company you are acting for, and how to change it.
 *
 * An accountant with two hundred clients cannot be handed a list of two
 * hundred, so the panel shows a few and searches the rest — by name or by VAT
 * number, because a client is often looked up by the number on the document in
 * front of you. The full list, with what each company is owed, is a page of its
 * own; this is the fast path between two companies you are working on today.
 *
 * The whole list is already in the browser (a company is a name and an id), so
 * filtering is instant and costs no round-trip.
 */
export function OrgSwitcher({ orgs, activeId }: { orgs: SwitcherOrg[]; activeId: string }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active = orgs.find((org) => org.id === activeId) ?? orgs[0];
  const needle = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!needle) return orgs;
    return orgs.filter(
      (org) =>
        (org.name ?? '').toLowerCase().includes(needle) ||
        (org.vatNumber ?? '').includes(needle),
    );
  }, [orgs, needle]);

  const shown = matches.slice(0, SHOWN);
  const hidden = matches.length - shown.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 max-w-[9rem] items-center gap-1.5 rounded-lg border border-ink-300 px-2.5 text-sm text-ink-700 transition hover:bg-ink-50 sm:min-h-0 sm:max-w-[22ch] sm:py-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{active?.name ?? t.companies.unnamed}</span>
        <span aria-hidden className="text-ink-400">
          ▾
        </span>
      </button>

      {open ? (
        <>
          {/* Click anywhere else to dismiss. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />

          {/* Fixed at 320px it hung off the left edge of a 360px screen and
              could not be reached. It now takes the width it is given, up to
              the same 320px, and stays inside the viewport. */}
          <div className="absolute right-0 z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-ink-200 bg-white p-2 shadow-lg">
            {orgs.length > SHOWN ? (
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.companies.searchPlaceholder}
                aria-label={t.companies.searchPlaceholder}
                className="mb-1 min-h-11 w-full rounded-lg border border-ink-300 px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:py-1.5 sm:text-sm"
              />
            ) : null}

            <ul className="max-h-72 overflow-y-auto">
              {shown.map((org) => (
                <li key={org.id}>
                  <form action={switchOrganization}>
                    <input type="hidden" name="id" value={org.id} />
                    {/* Stay where you are, in the other company's books. */}
                    <input type="hidden" name="next" value={pathname} />
                    <button
                      type="submit"
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-ink-50 ${
                        org.id === activeId ? 'font-medium text-ink-900' : 'text-ink-700'
                      }`}
                    >
                      <span className="min-w-0 truncate">{org.name ?? t.companies.unnamed}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {org.role === 'viewer' ? (
                          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                            {t.members.roleViewer}
                          </span>
                        ) : null}
                        {org.id === activeId ? <span aria-hidden>✓</span> : null}
                      </span>
                    </button>
                  </form>
                </li>
              ))}

              {!matches.length ? (
                <li className="px-2.5 py-3 text-sm text-ink-500">{t.companies.noMatches}</li>
              ) : null}
            </ul>

            <div className="mt-1 flex items-center justify-between border-t border-ink-100 pt-2 text-sm">
              <Link
                href="/companies"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1.5 text-ink-600 transition hover:bg-ink-50"
              >
                {hidden > 0 ? t.companies.seeAllWithRest(hidden) : t.companies.seeAll}
              </Link>
              <Link
                href="/companies/new"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1.5 font-medium text-brand-600 transition hover:bg-brand-50"
              >
                {t.companies.add}
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
