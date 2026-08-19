import type { NextConfig } from 'next';

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
        ],
      },
    ];
  },
};

export default nextConfig;
