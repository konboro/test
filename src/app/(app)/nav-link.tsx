'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-ink-100 text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
      }`}
    >
      {children}
    </Link>
  );
}
