import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader } from '@/components/ui';
import { bankingConfigured, listAspsps } from '@/lib/bank/client';
import { loadScenario } from '@/lib/dunning/engine';

import { DEFAULT_TEMPLATES, EDITABLE_SLOTS, slotKey } from '@/lib/dunning/templates';
import { getDictionary, type Dictionary } from '@/lib/i18n';
import { smsCreditsEnforced } from '@/lib/limits';
import { paymentsAvailable } from '@/lib/providers';
import { connectConfigured, SMS_PACKS } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { ElorusForm } from './elorus-forms';
import { BankConnect } from './bank-forms';
import { ScenarioForm } from './scenario-forms';
import { AutomationSwitch } from './automation-switch';
import { CreditPacks, MyDataForm, ProfileForm } from './settings-forms';
import { ProviderChooser } from './provider-chooser';
import { StripeConnect } from './stripe-forms';
import { VivaForm } from './viva-forms';
import { TemplateEditor, type TemplateSlotView } from './template-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).settings.title };
}
export const dynamic = 'force-dynamic';

/** Outcomes of the Connect round trip, reported back on the redirect. */
function stripeNotice(t: Dictionary, outcome: string | undefined): string | null {
  const notices = t.settings.stripeNotices;

  switch (outcome) {
    case 'connected':
      return notices.connected;
    case 'pending':
      return notices.pending;
    case 'cancelled':
      return notices.cancelled;
    case 'failed':
      return notices.failed;
    case 'already-linked':
      return notices.alreadyLinked;
    default:
      return null;
  }
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
        return {
          tone: 'warn',
          text: t.bank.notices.rateLimited,
        };
      }

      return {
        tone: 'warn',
        text: reason
          ? t.bank.notices.syncFailed(reason)
          : t.bank.notices.syncFailedPlain,
      };
    }
    case 'synced': {
      const found = Number(settledOr(counts.settled));
      const queued = Number(settledOr(counts.queued));
      const seen = Number(settledOr(counts.seen));
      const fetched = Number(settledOr(counts.fetched));
      const accounts = Number(settledOr(counts.accounts));

      if (found || queued) {
        return {
          tone: 'ok',
          text: t.bank.notices.matched(seen, found, queued),
        };
      }

      // "Nothing found" has three quite different causes and the operator can
      // act on each. Collapsing them into one sentence is what makes a working
      // integration look broken — and a broken one look merely quiet.
      if (accounts === 0) {
        return {
          tone: 'warn',
          text: t.bank.notices.noActiveAccounts,
        };
      }
      if (fetched === 0) {
        return {
          tone: 'ok',
          text: t.bank.notices.noMovements,
        };
      }
      if (seen === 0) {
        return {
          tone: 'ok',
          text: t.bank.notices.noCredits(fetched),
        };
      }

      return {
        tone: 'ok',
        text: t.bank.notices.nothingMatched(seen, fetched),
      };
    }
    case 'error':
      return { tone: 'warn', text: t.bank.notices.failed };
    default:
      return null;
  }
}

function settledOr(value: string | undefined): string {
  return value && /^\d+$/.test(value) ? value : '0';
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    credits?: string;
    stripe?: string;
    bank?: string;
    reason?: string;
    seen?: string;
    settled?: string;
    queued?: string;
    fetched?: string;
    accounts?: string;
  }>;
}) {
  const { credits, stripe, bank, seen, settled, queued, reason, fetched, accounts } =
    await searchParams;
  const t = await getDictionary();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select(
      'company_name, vat_number, reply_to_email, automation_enabled, mydata_user_id, mydata_environment, sms_credits, stripe_account_id, stripe_charges_enabled, locale, elorus_organization_id',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/login');

  // What the confirmation is actually asking about. A switch that warns
  // "reminders will start going out" is abstract; the same warning naming a
  // number is the difference between a setting and a decision.
  const { count: openInvoices } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  const stripeMessage = stripeNotice(t, stripe);
  const scenario = await loadScenario(user.id);
  const bankOutcome = bankNotice(t, bank, { seen, settled, queued, reason, fetched, accounts });

  const { data: bankConnections } = await supabase
    .from('bank_connections')
    .select('*')
    .order('created_at', { ascending: true });

  // The bank list comes from the provider. A failure there must not take the
  // settings page down with it — the card just says the service is unavailable.
  const banks = bankingConfigured()
    ? await listAspsps('GR').catch((cause) => {
        console.error('[settings:banks]', String(cause));
        return [];
      })
    : [];

  // The key column is excluded from the authenticated grant on purpose, so its
  // mere presence is read with the service role and nothing but a boolean leaves
  // this function.
  const { data: keyRow } = await createAdminClient()
    .from('users')
    .select('stripe_secret_key_enc, viva_client_id_enc, viva_client_secret_enc, viva_source_code, viva_environment, payment_provider')
    .eq('id', user.id)
    .maybeSingle();
  const hasOwnStripeKey = Boolean(keyRow?.stripe_secret_key_enc);
  const vivaConfigured = Boolean(keyRow?.viva_client_id_enc && keyRow?.viva_client_secret_enc);

  // RLS scopes this to the tenant. A slot with no row keeps the built-in copy.
  const { data: templates } = await supabase
    .from('message_templates')
    .select('step, channel, subject, body');

  // Not `t` — that is the dictionary in this scope.
  const overrides = new Map((templates ?? []).map((row) => [slotKey(row.step, row.channel), row]));

  const slots: TemplateSlotView[] = EDITABLE_SLOTS.map((slot) => {
    const override = overrides.get(slot.key);
    const fallback = DEFAULT_TEMPLATES[slot.key];

    return {
      key: slot.key,
      label: slot.label,
      channel: slot.channel,
      subject: override?.subject ?? fallback.subject,
      body: override?.body ?? fallback.body,
      customised: Boolean(override),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{t.settings.title}</h1>
        <p className="mt-0.5 text-sm text-ink-500">{t.settings.subtitle}</p>
      </div>

      {credits === 'success' ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {t.settings.creditsSuccess}
        </div>
      ) : null}
      {credits === 'cancelled' ? (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
          {t.settings.creditsCancelled}
        </div>
      ) : null}

      {stripeMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            stripe === 'connected'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : stripe === 'pending'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-ink-200 bg-white text-ink-600'
          }`}
        >
          {stripeMessage}
        </div>
      ) : null}

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

      <Card>
        <div id="automation" className="scroll-mt-20">
          <CardHeader
            title={t.settings.automation.title}
            subtitle={t.settings.automation.subtitle}
          />
          <AutomationSwitch
            enabled={profile.automation_enabled}
            openInvoices={openInvoices ?? 0}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title={t.settings.business} />
        <ProfileForm profile={profile} />
      </Card>

      <Card>
        <div id="stripe" className="scroll-mt-20">
          <CardHeader
            title={t.settings.stripe}
            subtitle={t.settings.stripeHint}
            action={
              profile.stripe_account_id ? (
                <Badge tone={profile.stripe_charges_enabled ? 'positive' : 'warning'}>
                  {profile.stripe_charges_enabled ? t.settings.stripeActive : t.settings.stripePending}
                </Badge>
              ) : hasOwnStripeKey ? (
                // The own-key arrangement never fills stripe_account_id — that
                // column belongs to Connect. Reading the badge off it alone told
                // a tenant whose payments were verified and live that they were
                // "not connected", on the same card that had just accepted the
                // key.
                <Badge tone="positive">{t.settings.stripeOwnKey}</Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <StripeConnect
            accountId={profile.stripe_account_id}
            chargesEnabled={profile.stripe_charges_enabled}
            available={connectConfigured()}
            hasOwnKey={hasOwnStripeKey}
          />
        </div>
      </Card>

      <Card>
        <div id="viva" className="scroll-mt-20">
          <CardHeader
            title={t.settings.viva}
            subtitle={t.settings.vivaHint}
            action={
              vivaConfigured ? (
                <Badge tone={keyRow?.viva_environment === 'production' ? 'positive' : 'warning'}>
                  {keyRow?.viva_environment === 'production'
                    ? t.settings.vivaProduction
                    : t.settings.vivaDemo}
                </Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <VivaForm
            configured={vivaConfigured}
            environment={keyRow?.viva_environment ?? 'demo'}
            sourceCode={keyRow?.viva_source_code ?? null}
          />
        </div>
      </Card>

      {/* Only worth asking once there is something to choose between. With one
          provider set up the answer is forced, and a dropdown with a single
          real option is a decision the operator does not have to make. */}
      {vivaConfigured && (hasOwnStripeKey || profile.stripe_account_id) ? (
        <Card>
          <CardHeader title={t.settings.providerTitle} subtitle={t.settings.providerHint} />
          <ProviderChooser current={keyRow?.payment_provider ?? null} />
        </Card>
      ) : null}

      {/* Collecting the money and noticing it arrived are separate problems:
          the cards above take card payments, this one reads the bank so a
          transfer settles the invoice on its own. */}
      <Card>
        <div id="scenario" className="scroll-mt-20">
          <CardHeader title={t.scenario.title} subtitle={t.scenario.hint} />
          <ScenarioForm scenario={scenario} />
        </div>
      </Card>

      <Card>
        <div id="bank" className="scroll-mt-20">
          <CardHeader
            title={t.settings.bankAccount}
            subtitle={t.settings.bankAccountHint}
            action={
              (bankConnections ?? []).some((c) => c.status === 'active') ? (
                <Badge tone="positive">{t.settings.connected}</Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <BankConnect banks={banks} connections={bankConnections ?? []} t={t} />
        </div>
      </Card>

      <Card>
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
        <ElorusForm
          connected={Boolean(profile.elorus_organization_id)}
          organizationId={profile.elorus_organization_id}
        />
      </Card>

      {profile.mydata_user_id || !profile.elorus_organization_id ? (
      <Card>
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
        <MyDataForm
          connected={Boolean(profile.mydata_user_id)}
          userId={profile.mydata_user_id}
          environment={profile.mydata_environment}
        />
      </Card>
      ) : null}

      {/* A purchase card, so it needs both halves of a purchase: a meter that
          governs something, and a platform account that can take the money. */}
      {smsCreditsEnforced() && paymentsAvailable() ? (
      <Card>
        <div id="credits" className="scroll-mt-20">
          <CardHeader
            title={t.settings.smsTitle}
            subtitle={t.settings.smsHint}
            action={
              <span className="tabular text-sm font-semibold text-ink-900">
                {t.settings.smsAvailable(profile.sms_credits)}
              </span>
            }
          />
          <CreditPacks packs={SMS_PACKS} />
        </div>
      </Card>
      ) : null}

      <Card>
        <CardHeader
          title={t.settings.templatesTitle}
          subtitle={t.settings.templatesHint}
        />
        <TemplateEditor slots={slots} />
      </Card>

  </div>
  );
}
