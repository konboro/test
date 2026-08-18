import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isPayCode } from '@/lib/pay-code';
import type { Database } from '@/types/database';

const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/auth',
  // The debtor-facing payment page reached by an old, long reminder link, and
  // the checkout it starts. Both see anonymous visitors holding only a payment
  // credential.
  '/pay',
  '/api/pay',
  // The pay page's view beacon — fired by the same anonymous visitor the page
  // itself serves. It answers 204 unconditionally and records a funnel event.
  '/api/beacon',
  // Where the provider sends the debtor back afterwards. These have to be public
  // for the same reason the payment page does — the visitor has no session and
  // never will — and they are what settle an invoice for a tenant with no
  // webhook pointed at us. Gating them turns a completed payment into a bare
  // "Unauthorized" in the debtor's browser.
  '/api/stripe/confirm',
  '/api/viva/return',
  // Authenticated by Stripe's signature, not by a session cookie.
  '/api/stripe/webhook',
  // Authenticated by the CRON_SECRET bearer token.
  '/api/cron',
];

function isPublic(pathname: string) {
  if (pathname === '/') return true;

  // Short payment links sit at the root: /<code>. The code alphabet carries no
  // lowercase, so this test can never swallow one of the app's own routes and
  // hand an unauthenticated visitor /invoices or /settings.
  if (isPayCode(pathname.slice(1))) return true;

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
