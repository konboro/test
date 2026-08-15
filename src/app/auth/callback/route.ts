import { NextResponse, type NextRequest } from 'next/server';

import { safeNextPath } from '@/lib/redirects';
import { createClient } from '@/lib/supabase/server';

/** Exchanges the emailed confirmation code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get('next'))}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
