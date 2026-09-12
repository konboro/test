import Link from 'next/link';

import { LeftaLogo } from '@/components/logo';
import { linkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

import { RegisterForm } from './register-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).auth.registerTitle };
}

export default async function RegisterPage() {
  const t = await getDictionary();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" aria-label="lefta.app" className="flex justify-center">
          <LeftaLogo markClassName="h-9 w-9" textClassName="text-xl" />
        </Link>
        <h1 className="mt-6 text-center text-lg font-semibold text-ink-900">
          {t.auth.registerLink}
        </h1>

        <RegisterForm />

        <p className="mt-6 text-center text-sm text-ink-500">
          {t.auth.haveAccount}{' '}
          <Link href="/login" className={linkClass}>
            {t.auth.signInLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
