import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/auth/actions';
import { LeftaLogo } from '@/components/logo';
import { LocaleSwitch } from '@/components/locale-switch';
import { OrgSwitcher } from '@/components/org-switcher';
import { getDictionary, getLocale } from '@/lib/i18n';
import { LocaleProvider } from '@/lib/i18n/provider';
import { smsCreditsEnforced } from '@/lib/limits';
import { activeOrganization, listOrganizations } from '@/lib/orgs/active';
import { createClient } from '@/lib/supabase/server';

import { MobileNav } from './mobile-nav';
import { NavLink } from './nav-link';
import { ProfileMenu } from './profile-menu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Which company this session is acting for — not which person is signed in.
  // Everything below the header is scoped to it by the policies; the header
  // says which one it is and offers the others.
  const [orgs, active] = await Promise.all([listOrganizations(), activeOrganization()]);

  // No company at all — someone whose last membership was revoked, or an
  // account created before the signup trigger existed. The navigation would
  // lead nowhere, so it is left out entirely and the page (which is
  // /companies/new, where requireOrganization sends them) gets a bare shell.
  // Redirecting from here instead would be a loop: that page lives under this
  // layout too.
  if (!active) {
    return (
      <LocaleProvider locale={locale}>
        <div className="min-h-screen">
          <header className="border-b border-ink-200/90 bg-white/90">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <LeftaLogo />
              <div className="flex items-center gap-3">
                <LocaleSwitch />
                <form action={signOut}>
                  <button
                    type="submit"
                    className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50"
                  >
                    {t.common.signOut}
                  </button>
                </form>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </div>
      </LocaleProvider>
    );
  }

  // No filter: the policy on `users` already shows exactly the active company,
  // which is the whole point of it. Filtering by the resolved id made this wait
  // for the organisation lookup for no reason — a serial round-trip on every
  // navigation, across the Atlantic until the region was pinned.
  const { data: profile } = await supabase
    .from('users')
    .select('company_name, email, sms_credits, business_mode')
    .limit(1)
    .maybeSingle();

  const NAV = [
    { href: '/dashboard', label: t.nav.dashboard },
    { href: '/invoices', label: t.nav.invoices },
    // Only for a company that says it lets property. To everyone else a
    // leases screen is a menu item that opens an empty page.
    ...(profile?.business_mode === 'landlord'
      ? [{ href: '/leases', label: t.nav.leases }]
      : []),
    { href: '/debtors', label: t.nav.debtors },
    { href: '/bank', label: t.nav.bank },
    { href: '/logs', label: t.nav.logs },
    // Only once there is more than one: for a single company the portfolio and
    // the dashboard answer the same question, and a navigation item that
    // duplicates the one beside it is noise.
    ...(orgs.length > 1 ? [{ href: '/companies', label: t.nav.companies }] : []),
    { href: '/settings', label: t.nav.settings },
  ];

  return (
    <LocaleProvider locale={locale}>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200/90 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" aria-label="lefta.app">
              <LeftaLogo />
            </Link>
            <nav className="hidden gap-1 md:flex">
              {NAV.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <OrgSwitcher
              orgs={orgs.map((org) => ({
                id: org.id,
                name: org.name,
                vatNumber: org.vatNumber,
                role: org.role,
              }))}
              activeId={active.id}
            />
            <div className="hidden sm:block">
              <LocaleSwitch />
            </div>
            <ProfileMenu
              companyName={profile?.company_name ?? null}
              email={profile?.email ?? user.email ?? null}
              smsCredits={profile?.sms_credits ?? 0}
              showCredits={smsCreditsEnforced()}
            />
          </div>
        </div>

      </header>

      {/* Room for the bar, plus whatever the phone reserves for its own home
          indicator. Without it the last row of every page sits under the bar. */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:py-8 md:pb-8">
        {children}
      </main>

      <MobileNav items={NAV} />
    </div>
    </LocaleProvider>
  );
}
