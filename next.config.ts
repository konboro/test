import type { NextConfig } from 'next';

// Nothing on this site loads from anywhere else — checked against the served
// HTML of the landing page, the login page and a live payment page, none of
// which reference a single external origin. That is what makes a real policy
// possible rather than a permissive one written to avoid breakage.
//
// connect-src carries Supabase because the browser client refreshes its own
// session; wss is there for realtime. The redirect to Stripe is a top-level
// navigation, not a fetch, so it is unaffected by any of this.
//
// script-src keeps 'unsafe-inline': Next injects inline bootstrap and flight
// scripts, and removing it needs per-request nonces through the middleware.
// Stated plainly rather than papered over — the policy still blocks external
// script origins, object embedding and base-uri hijacking, which is most of
// what an injected payload wants.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // unpdf ships a pdf.js build that must not be bundled by the compiler.
  serverExternalPackages: ['stripe', 'unpdf'],
  experimental: {
    // Server actions accept 1 MB by default, which rejects essentially every
    // scanned invoice. Matches the bucket limit set in the migration so a file
    // is refused in one place with one message, rather than passing the form
    // and failing at storage.
    serverActions: { bodySizeLimit: '20mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp },
          // The app asks for none of these; saying so stops an injected script
          // from asking on its behalf.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), usb=(), magnetometer=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
