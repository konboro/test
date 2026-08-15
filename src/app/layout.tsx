import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'lefta.app — Αυτοματοποιημένες εισπράξεις',
  description:
    'Συνδέεται με το myDATA, στέλνει αυτόματες υπενθυμίσεις πληρωμής και δίνει στους πελάτες σας σύνδεσμο άμεσης εξόφλησης.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
