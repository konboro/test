import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  // `template` keeps the wordmark in the tab title on every page without each
  // one having to repeat it.
  title: {
    default: 'lefta.app — Αυτοματοποιημένες εισπράξεις',
    template: '%s — lefta.app',
  },
  description:
    'Συνδέεται με το myDATA, στέλνει αυτόματες υπενθυμίσεις πληρωμής και δίνει στους πελάτες σας σύνδεσμο άμεσης εξόφλησης.',
  applicationName: 'lefta.app',
};

export const viewport: Viewport = {
  // Tints the browser chrome on mobile to match the header.
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
