import { TabStrip } from '@/components/tab-strip';
import { getDictionary } from '@/lib/i18n';

/**
 * The three screens you read rather than work on.
 *
 * The portfolio's shape, what was sent, and what arrived: each answers "how is
 * this going" from a different side, and each was its own line in a navigation
 * that had grown to ten. Under one heading they cost one line, and moving
 * between them stops being a trip back to the menu.
 *
 * A route group, so the URLs do not change. `/bank`, `/logs` and `/statistics`
 * are in reminder footers, in this codebase's revalidation calls and in
 * whatever anyone has bookmarked; grouping them for the sake of a shared frame
 * is not worth breaking any of that, and Next lets the two be independent.
 */
export default async function InsightsLayout({ children }: { children: React.ReactNode }) {
  const t = await getDictionary();

  return (
    <div className="space-y-6">
      <TabStrip
        label={t.nav.insights}
        tabs={[
          { href: '/statistics', label: t.nav.statistics },
          { href: '/logs', label: t.nav.logs },
          { href: '/bank', label: t.nav.bank },
        ]}
      />

      {children}
    </div>
  );
}
