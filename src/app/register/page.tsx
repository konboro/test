import Link from 'next/link';

import { linkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';

import { RegisterForm } from './register-form';

export async function generateMetadata() {
  return { title: (await getDictionary()).auth.registerTitle };
}

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center text-xl font-semibold tracking-tight">
          lefta<span className="text-brand-500">.app</span>
        </Link>
        <h1 className="mt-6 text-center text-lg font-semibold text-ink-900">
          Δημιουργία λογαριασμού
        </h1>

        <RegisterForm />

        <p className="mt-6 text-center text-sm text-ink-500">
          Έχετε ήδη λογαριασμό;{' '}
          <Link href="/login" className={linkClass}>
            Σύνδεση
          </Link>
        </p>
      </div>
    </main>
  );
}
