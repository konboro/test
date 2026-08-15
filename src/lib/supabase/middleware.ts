import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import type { Database } from '@/types/database';

const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/auth',
  // The debtor-facing payment page and the Checkout session it starts. Both are
  // reached by anonymous visitors holding only a pay token.
  '/pay',
  '/api/stripe/pay',
  // Authenticated by Stripe's signature, not by a session cookie.
  '/api/stripe/webhook',
  // Authenticated by the CRON_SECRET bearer token.
  '/api/cron',
];

function isPublic(pathname: string) {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the auth session on every request and gates the dashboard.
 *
 * Cookie handling follows the @supabase/ssr contract: the response object must
 * be rebuilt after cookies are written so refreshed tokens reach the browser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    // API callers get a status code they can act on; a redirect to an HTML login
    // page would surface as an unparseable response in the client fetch.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
