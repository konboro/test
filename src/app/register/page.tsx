import Link from 'next/link';

import { RegisterForm } from './register-form';

export const metadata = { title: 'Εγγραφή — lefta.app' };

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
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Σύνδεση
          </Link>
        </p>
      </div>
    </main>
  );
}
