import { getDictionary } from '@/lib/i18n';

import { SettingsTabs } from './tabs';

/**
 * The frame every settings screen shares: the title, and the tabs.
 *
 * The screen used to be one page of fourteen cards under four grey group
 * headings, in the order the integrations happened to be built. Reading it cost
 * fourteen sequential queries and an external call to the bank aggregator, on
 * every visit, whatever the visitor had actually come to change.
 *
 * The four groups were already the right division — they answer the questions
 * an operator has, in the order they have them — so they became the tabs, with
 * the people who can act for the company as a fifth. That last one already had
 * a page and no link anywhere in the product: it was reachable only by typing
 * the URL.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getDictionary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.settings.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.settings.subtitle}</p>
      </div>

      <SettingsTabs
        tabs={[
          { href: '/settings', label: t.settings.tabs.business },
          { href: '/settings/reminders', label: t.settings.tabs.reminders },
          { href: '/settings/payments', label: t.settings.tabs.payments },
          { href: '/settings/sources', label: t.settings.tabs.sources },
          { href: '/settings/members', label: t.settings.tabs.team },
        ]}
      />

      {children}
    </div>
  );
}
