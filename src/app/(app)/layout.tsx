import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';

import { NavLink } from './nav-link';

const NAV = [
  { href: '/dashboard', label: 'Επισκόπηση' },
  { href: '/invoices', label: 'Παραστατικά' },
  { href: '/debtors', label: 'Πελάτες' },
  { href: '/logs', label: 'Ιστορικό επικοινωνίας' },
  { href: '/settings', label: 'Ρυθμίσεις' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

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
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-base font-semibold tracking-tight">
              lefta<span className="text-brand-500">.app</span>
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
            <Link
              href="/settings#credits"
              className="tabular hidden rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-700 sm:block"
              title="Διαθέσιμα SMS"
            >
              {profile?.sms_credits ?? 0} SMS
            </Link>
            <span className="hidden max-w-[16ch] truncate text-sm text-ink-500 lg:block">
              {profile?.company_name ?? profile?.email ?? user.email}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50"
              >
                Έξοδος
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
  );
}
