import { ImageResponse } from 'next/og';

import { getDictionary } from '@/lib/i18n';

export const alt = 'lefta.app';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The card a shared link shows in a chat or a feed.
 *
 * Generated rather than uploaded, so it cannot drift from the brand the way a
 * PNG committed once and forgotten does — the mark here is the same geometry as
 * `components/logo.tsx` and the tagline is the same copy the page renders.
 *
 * Deliberately no web font: `next/og` needs the font bytes at render time, and
 * fetching them would put a network call on the path that renders a preview
 * image. The system stack it falls back to is legible at this size, which is all
 * this has to be.
 */
export default async function Image() {
  const t = await getDictionary();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#ffffff',
          padding: '80px',
        }}
      >
        {/* The mark: the same rounded tile and lambda the product uses. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: 26,
              background: '#4c6ef5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: 76,
              fontWeight: 700,
            }}
          >
            λ
          </div>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, letterSpacing: '-0.03em' }}>
            <span style={{ color: '#0f172a' }}>lefta</span>
            <span style={{ color: '#3b6df5' }}>.app</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 56,
            fontSize: 44,
            lineHeight: 1.25,
            color: '#1e293b',
            maxWidth: 900,
          }}
        >
          {t.landing.heroTitle}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 26,
            color: '#64748b',
            maxWidth: 880,
          }}
        >
          {t.common.appDescription}
        </div>

        {/* The money-path blue, echoing the rule on the payment page. */}
        <div style={{ display: 'flex', marginTop: 'auto', height: 10, background: '#3b6df5' }} />
      </div>
    ),
    size,
  );
}
