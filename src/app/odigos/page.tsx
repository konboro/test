import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { ButtonLink } from '@/components/ui';
import { GUIDES } from '@/lib/guides';

export const metadata = {
  title: 'Οδηγοί',
  description:
    'Πρακτικοί οδηγοί για την είσπραξη ανεξόφλητων τιμολογίων, τις υπενθυμίσεις πληρωμής και το myDATA.',
  alternates: { canonical: '/odigos' },
};

export default function GuidesPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" aria-label="lefta.app">
            <LeftaLogo />
          </Link>
          <ButtonLink href="/register" variant="brand">
            Δωρεάν δοκιμή
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Οδηγοί</h1>
        <p className="mt-2 text-base leading-relaxed text-ink-600">
          Ό,τι μάθαμε φτιάχνοντας το lefta.app, γραμμένο για επιχειρήσεις που κυνηγούν τα δικά τους
          τιμολόγια.
        </p>

        <ul className="mt-10 space-y-6">
          {GUIDES.map((guide) => (
            <li key={guide.slug} className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-900">
                <Link href={`/odigos/${guide.slug}`} className="hover:text-brand-600">
                  {guide.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{guide.summary}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
