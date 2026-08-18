import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { linkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

import { LoginForm } from './login-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).auth.signInTitle };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getDictionary();
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" aria-label="lefta.app" className="flex justify-center">
          <LeftaLogo markClassName="h-9 w-9" textClassName="text-xl" />
        </Link>
        <h1 className="mt-6 text-center text-lg font-semibold text-ink-900">{t.auth.signInTitle}</h1>
        <p className="mt-1 text-center text-sm text-ink-500">
          {t.auth.tagline}
        </p>

        <LoginForm next={next} />

        <p className="mt-6 text-center text-sm text-ink-500">
          {t.auth.noAccount}{' '}
          <Link href="/register" className={linkClass}>
            {t.auth.createLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
