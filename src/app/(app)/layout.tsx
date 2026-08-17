import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/auth/actions';
import { LeftaLogo } from '@/components/logo';
import { getDictionary, getLocale } from '@/lib/i18n';
import { LocaleProvider } from '@/lib/i18n/provider';
import { smsCreditsEnforced } from '@/lib/limits';
import { createClient } from '@/lib/supabase/server';

import { NavLink } from './nav-link';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const supabase = await createClient();

  const NAV = [
    { href: '/dashboard', label: t.nav.dashboard },
    { href: '/invoices', label: t.nav.invoices },
    { href: '/debtors', label: t.nav.debtors },
    { href: '/logs', label: t.nav.logs },
    { href: '/settings', label: t.nav.settings },
  ];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('company_name, email, sms_credits')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <LocaleProvider locale={locale}>
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
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
            {smsCreditsEnforced() ? (
              <Link
                href="/settings#credits"
                className="tabular hidden rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-700 sm:block"
                title={t.nav.smsCredits}
              >
                {profile?.sms_credits ?? 0} SMS
              </Link>
            ) : null}
            <span className="hidden max-w-[16ch] truncate text-sm text-ink-500 lg:block">
              {profile?.company_name ?? profile?.email ?? user.email}
            </span>
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

        <nav className="flex gap-1 overflow-x-auto border-t border-ink-200 px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
    </LocaleProvider>
  );
}
