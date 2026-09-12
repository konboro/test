import { Badge, Card, CardHeader } from '@/components/ui';
import { bankingConfigured, listAspsps } from '@/lib/bank/client';
import { getDictionary, type Dictionary } from '@/lib/i18n';

import { noProfile, settingsAccess } from '../access';
import { BankConnect } from '../bank-forms';
import { DataSources } from '../data-sources';
import { ElorusForm } from '../elorus-forms';
import { MyDataForm } from '../settings-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).settings.tabs.sources };
}
export const dynamic = 'force-dynamic';

function settledOr(value: string | undefined): string {
  return value && /^\d+$/.test(value) ? value : '0';
}

/**
 * What came back from the bank round trip.
 *
 * A sync that found nothing is still an answer, and the most likely one: it has
 * to read as "we looked", not as silence, or the operator presses the button
 * again believing it failed.
 */
function bankNotice(
  t: Dictionary,
  outcome: string | undefined,
  counts: {
    seen?: string;
    settled?: string;
    queued?: string;
    reason?: string;
    fetched?: string;
    accounts?: string;
  },
): { tone: 'ok' | 'warn'; text: string } | null {
  switch (outcome) {
    case 'connected':
      return { tone: 'ok', text: t.bank.notices.connected };
    case 'cancelled':
      return { tone: 'warn', text: t.bank.notices.cancelled };
    case 'no_accounts':
      return { tone: 'warn', text: t.bank.notices.noAccounts };
    case 'unavailable':
      return { tone: 'warn', text: t.bank.notices.unavailable };
    case 'sync_failed': {
      const reason = counts.reason ?? '';

      // Only call it a rate limit when the provider actually said 429. The
      // first version asserted it for every failure, which is a confident wrong
      // answer: it sends the operator away to wait out a limit that may have
      // had nothing to do with it.
      if (reason.includes('429')) {
        return { tone: 'warn', text: t.bank.notices.rateLimited };
      }

      return {
        tone: 'warn',
        text: reason ? t.bank.notices.syncFailed(reason) : t.bank.notices.syncFailedPlain,
      };
    }
    case 'synced': {
      const found = Number(settledOr(counts.settled));
      const queued = Number(settledOr(counts.queued));
      const seen = Number(settledOr(counts.seen));
      const fetched = Number(settledOr(counts.fetched));
      const accounts = Number(settledOr(counts.accounts));

      if (found || queued) {
        return { tone: 'ok', text: t.bank.notices.matched(seen, found, queued) };
      }

      // "Nothing found" has three quite different causes and the operator can
      // act on each. Collapsing them into one sentence is what makes a working
      // integration look broken — and a broken one look merely quiet.
      if (accounts === 0) {
        return { tone: 'warn', text: t.bank.notices.noActiveAccounts };
      }
      if (fetched === 0) {
        return { tone: 'ok', text: t.bank.notices.noMovements };
      }
      if (seen === 0) {
        return { tone: 'ok', text: t.bank.notices.noCredits(fetched) };
      }

      return { tone: 'ok', text: t.bank.notices.nothingMatched(seen, fetched) };
    }
    case 'error':
      return { tone: 'warn', text: t.bank.notices.failed };
    default:
      return null;
  }
}

/**
 * Where the invoices come from, and how a payment is noticed.
 *
 * The list of Greek banks is fetched from the aggregator to render this screen,
 * which is the reason it is a screen of its own: it used to be fetched on every
 * visit to settings, including the visits that came to change the reply-to
 * address.
 */
export default async function SourcesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    bank?: string;
    reason?: string;
    seen?: string;
    settled?: string;
    queued?: string;
    fetched?: string;
    accounts?: string;
  }>;
}) {
  const { bank, seen, settled, queued, reason, fetched, accounts } = await searchParams;
  const t = await getDictionary();
  const { supabase, org } = await settingsAccess();

  const bankOutcome = bankNotice(t, bank, { seen, settled, queued, reason, fetched, accounts });

  const [{ data: profile, error }, { data: bankConnections }, banks] = await Promise.all([
    supabase
      .from('users')
      .select(
        'mydata_user_id, mydata_environment, mydata_last_sync_at, elorus_organization_id, elorus_last_sync_at',
      )
      .eq('id', org.id)
      .maybeSingle(),
    supabase.from('bank_connections').select('*').order('created_at', { ascending: true }),
    // The bank list comes from the provider. A failure there must not take the
    // page down with it — the card just says the service is unavailable.
    bankingConfigured()
      ? listAspsps('GR').catch((cause) => {
          console.error('[settings:banks]', String(cause));
          return [];
        })
      : Promise.resolve([]),
  ]);

  if (!profile) noProfile('sources', error);

  const connections = bankConnections ?? [];
  const bankActive = connections.some((c) => c.status === 'active');

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-500">
        {t.settings.tabIntro.sources}
      </p>

      {bankOutcome ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            bankOutcome.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {bankOutcome.text}
        </div>
      ) : null}

      {/* Moved here from the dashboard, where it repeated what the cards below
          already say. It is kept rather than dropped because it carries the
          only manual "sync now" in the product — the settings screen had the
          forms to connect a source and no way to make one run. */}
      <DataSources
        sources={{
          billing: {
            configured: Boolean(profile.elorus_organization_id),
            lastSync: profile.elorus_last_sync_at ?? null,
          },
          mydata: {
            configured: Boolean(profile.mydata_user_id),
            lastSync: profile.mydata_last_sync_at ?? null,
          },
          bank: {
            configured: bankActive,
            // The most recent read across every connected account: one stale
            // account among several is still a reason to press the button.
            lastSync:
              connections
                .filter((c) => c.status === 'active')
                .map((c) => c.last_synced_at)
                .filter((at): at is string => Boolean(at))
                .sort()
                .at(-1) ?? null,
          },
        }}
      />

      {profile.mydata_user_id || !profile.elorus_organization_id ? (
        <Card>
          <div id="mydata" className="scroll-mt-20">
            <CardHeader
              title={t.settings.mydata}
              subtitle={t.settings.mydataHint}
              action={
                profile.mydata_user_id ? (
                  <Badge tone="positive">{t.settings.connected}</Badge>
                ) : (
                  <Badge tone="warning">{t.settings.notConnected}</Badge>
                )
              }
            />
          </div>
          <MyDataForm
            connected={Boolean(profile.mydata_user_id)}
            userId={profile.mydata_user_id}
            environment={profile.mydata_environment}
          />
        </Card>
      ) : null}

      <Card>
        <div id="elorus" className="scroll-mt-20">
          <CardHeader
            title={t.settings.elorus}
            subtitle={t.settings.elorusHint}
            action={
              profile.elorus_organization_id ? (
                <Badge tone="positive">{t.settings.connected}</Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
        </div>
        <ElorusForm
          connected={Boolean(profile.elorus_organization_id)}
          organizationId={profile.elorus_organization_id}
        />
      </Card>

      {/* Collecting the money and noticing it arrived are separate problems.
          The payment cards take card payments; this reads the bank, so a
          transfer settles the invoice without anyone ticking it off. */}
      <Card>
        <div id="bank" className="scroll-mt-20">
          <CardHeader
            title={t.settings.bankAccount}
            subtitle={t.settings.bankAccountHint}
            action={
              bankActive ? (
                <Badge tone="positive">{t.settings.connected}</Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <BankConnect banks={banks} connections={connections} t={t} />
        </div>
      </Card>
    </div>
  );
}
