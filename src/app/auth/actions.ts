'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { safeNextPath } from '@/lib/redirects';
import { createClient } from '@/lib/supabase/server';

export interface AuthState {
  error?: string;
  notice?: string;
}

const credentials = z.object({
  email: z.string().email('Δώστε ένα έγκυρο email.'),
  password: z.string().min(8, 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.'),
});

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: 'Λάθος email ή κωδικός.' };
  }

  redirect(safeNextPath(formData.get('next')));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Μη έγκυρα στοιχεία.' };
  }

  const companyName = String(formData.get('company_name') ?? '').trim();
  if (!companyName) return { error: 'Συμπληρώστε την επωνυμία της επιχείρησης.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    // Consumed by the `handle_new_auth_user` trigger, which provisions the
    // tenant row in public.users.
    options: { data: { company_name: companyName } },
  });

  if (error) {
    return { error: error.message };
  }

  // With email confirmation enabled the user has no session yet.
  if (!data.session) {
    return { notice: 'Ελέγξτε το email σας για να επιβεβαιώσετε τον λογαριασμό.' };
  }

  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
