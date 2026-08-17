import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader } from '@/components/ui';
import { bankingConfigured, listAspsps } from '@/lib/bank/client';
import { LADDER } from '@/lib/dunning/engine';

import { DEFAULT_TEMPLATES, EDITABLE_SLOTS, slotKey } from '@/lib/dunning/templates';
import { DICTIONARIES } from '@/lib/i18n/dictionaries';
import { getDictionary, LOCALES } from '@/lib/i18n';
import { smsCreditsEnforced } from '@/lib/limits';
import { paymentsAvailable } from '@/lib/providers';
import { connectConfigured, SMS_PACKS } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { updateLocale } from './actions';
import { ElorusForm } from './elorus-forms';
import { BankConnect } from './bank-forms';
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
const STRIPE_NOTICES: Record<string, string> = {
  connected: 'Ο λογαριασμός Stripe συνδέθηκε. Οι πελάτες σας μπορούν πλέον να πληρώνουν με κάρτα.',
  pending:
    'Ο λογαριασμός συνδέθηκε, αλλά το Stripe δεν έχει ολοκληρώσει τον έλεγχο. Το κουμπί πληρωμής θα ενεργοποιηθεί αυτόματα μόλις ολοκληρωθεί.',
  cancelled: 'Η σύνδεση με το Stripe ακυρώθηκε.',
  failed: 'Η σύνδεση με το Stripe απέτυχε. Δοκιμάστε ξανά.',
  'already-linked':
    'Αυτός ο λογαριασμός Stripe χρησιμοποιείται ήδη από άλλον χρήστη του lefta.app.',
};

/**
 * What came back from the bank round trip.
 *
 * A sync that found nothing is still an answer, and the most likely one: it has
 * to read as "we looked", not as silence, or the operator presses the button
 * again believing it failed.
 */
function bankNotice(
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
      return { tone: 'ok', text: 'Ο τραπεζικός λογαριασμός συνδέθηκε.' };
    case 'cancelled':
      return { tone: 'warn', text: 'Η σύνδεση με την τράπεζα ακυρώθηκε.' };
    case 'no_accounts':
      return { tone: 'warn', text: 'Η τράπεζα δεν επέστρεψε κανέναν λογαριασμό.' };
    case 'unavailable':
      return { tone: 'warn', text: 'Η υπηρεσία τραπεζικής σύνδεσης δεν είναι διαθέσιμη.' };
    case 'sync_failed': {
      const reason = counts.reason ?? '';

      // Only call it a rate limit when the provider actually said 429. The
      // first version asserted it for every failure, which is a confident wrong
      // answer: it sends the operator away to wait out a limit that may have
      // had nothing to do with it.
      if (reason.includes('429')) {
        return {
          tone: 'warn',
          text: 'Οι τράπεζες περιορίζουν τους ελέγχους ανά ημέρα και το όριο εξαντλήθηκε. Δοκιμάστε αύριο — ο αυτόματος έλεγχος συνεχίζεται κανονικά.',
        };
      }

      return {
        tone: 'warn',
        text: reason
          ? `Ο έλεγχος δεν ολοκληρώθηκε: ${reason}`
          : 'Ο έλεγχος δεν ολοκληρώθηκε.',
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
          text: `Ελέγχθηκαν ${seen} εισπράξεις: ${found} παραστατικά εξοφλήθηκαν αυτόματα, ${queued} χρειάζονται επιβεβαίωση.`,
        };
      }

      // "Nothing found" has three quite different causes and the operator can
      // act on each. Collapsing them into one sentence is what makes a working
      // integration look broken — and a broken one look merely quiet.
      if (accounts === 0) {
        return {
          tone: 'warn',
          text: 'Κανένας ενεργός λογαριασμός προς έλεγχο. Συνδέστε τράπεζα ή ανανεώστε τη ληγμένη άδεια.',
        };
      }
      if (fetched === 0) {
        return {
          tone: 'ok',
          text: 'Η τράπεζα δεν επέστρεψε καμία κίνηση για το διάστημα που ζητήθηκε.',
        };
      }
      if (seen === 0) {
        return {
          tone: 'ok',
          text: `Η τράπεζα επέστρεψε ${fetched} κινήσεις, καμία εισερχόμενη — μόνο χρεώσεις στο διάστημα αυτό.`,
        };
      }

      return {
        tone: 'ok',
        text: `Ελέγχθηκαν ${seen} εισπράξεις από ${fetched} κινήσεις. Καμία δεν αντιστοιχεί σε ανοιχτό παραστατικό.`,
      };
    }
    case 'error':
      return { tone: 'warn', text: 'Η σύνδεση με την τράπεζα απέτυχε. Δοκιμάστε ξανά.' };
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

  const bankOutcome = bankNotice(bank, { seen, settled, queued, reason, fetched, accounts });

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

  const stepLabels: Record<DunningStep, string> = {
    pre_due: t.steps.longPreDue,
    overdue_2: t.steps.longOverdue2,
    overdue_10: t.steps.longOverdue10,
  };

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
          Η πληρωμή ολοκληρώθηκε. Τα SMS πιστώνονται μόλις επιβεβαιωθεί από το Stripe — συνήθως
          σε λίγα δευτερόλεπτα.
        </div>
      ) : null}
      {credits === 'cancelled' ? (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
          Η αγορά ακυρώθηκε. Δεν χρεωθήκατε.
        </div>
      ) : null}

      {STRIPE_NOTICES[stripe ?? ''] ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            stripe === 'connected'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : stripe === 'pending'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-ink-200 bg-white text-ink-600'
          }`}
        >
          {STRIPE_NOTICES[stripe ?? '']}
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
        <CardHeader title={t.settings.language} subtitle={t.settings.languageHint} />
        <form action={updateLocale} className="flex flex-wrap gap-2 px-5 py-4">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="submit"
              name="locale"
              value={code}
              aria-current={profile.locale === code}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                profile.locale === code
                  ? 'bg-ink-900 text-white'
                  : 'border border-ink-300 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              {DICTIONARIES[code].languageName}
            </button>
          ))}
        </form>
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
        <div id="bank" className="scroll-mt-20">
          <CardHeader
            title="Τραπεζικός λογαριασμός"
            subtitle="Εντοπισμός εξοφλήσεων με έμβασμα, ώστε οι υπενθυμίσεις να σταματούν μόνες τους."
            action={
              (bankConnections ?? []).some((c) => c.status === 'active') ? (
                <Badge tone="positive">{t.settings.connected}</Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <BankConnect banks={banks} connections={bankConnections ?? []} />
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

      <Card>
        <CardHeader
          title={t.settings.flowTitle}
          subtitle={t.settings.flowHint}
        />
        <ol className="divide-y divide-ink-100">
          {LADDER.map((rung) => (
            <li key={rung.step} className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-ink-900">{stepLabels[rung.step]}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {rung.offsetFrom < 0
                    ? t.settings.beforeDue(Math.abs(rung.offsetFrom))
                    : t.settings.afterDue(rung.offsetFrom)}
                </p>
              </div>
              <div className="flex gap-1.5">
                {rung.channels.map((channel) => (
                  <Badge key={channel} tone={channel === 'sms' ? 'info' : 'neutral'}>
                    {channel === 'sms' ? t.common.sms : t.common.email}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-ink-100 bg-ink-50 px-5 py-4 text-xs leading-relaxed text-ink-600">
          <p>
            <strong className="font-semibold text-ink-800">{t.settings.rateLimitLabel}</strong>{' '}
            {t.settings.rateLimitBody}
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink-800">{t.settings.autoStopLabel}</strong>{' '}
            {t.settings.autoStopBody}
          </p>
        </div>
      </Card>
    </div>
  );
}
