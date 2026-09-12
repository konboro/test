import { Badge, Card, CardHeader } from '@/components/ui';
import { getDictionary, type Dictionary } from '@/lib/i18n';
import { connectConfigured } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

import { noProfile, settingsAccess } from '../access';
import { PaymentNoticeSwitch } from '../payment-notice-switch';
import { ProviderChooser } from '../provider-chooser';
import { RevolutForm } from '../revolut-forms';
import { StripeConnect } from '../stripe-forms';
import { VivaForm } from '../viva-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).settings.tabs.payments };
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
 * How customers pay by card.
 *
 * Three providers and the choice between them. The keys themselves are read
 * with the service role and never leave this function: the columns holding them
 * are excluded from the authenticated grant on purpose, so what the page learns
 * is a boolean per provider and nothing more.
 */
export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const { stripe } = await searchParams;
  const t = await getDictionary();
  const { supabase, org } = await settingsAccess();

  const [{ data: profile, error }, { data: keyRow }] = await Promise.all([
    supabase
      .from('users')
      .select('stripe_account_id, stripe_charges_enabled, notify_on_payment')
      .eq('id', org.id)
      .maybeSingle(),
    createAdminClient()
      .from('users')
      .select(
        'stripe_secret_key_enc, viva_client_id_enc, viva_client_secret_enc, viva_source_code, viva_environment, revolut_secret_key_enc, revolut_environment, payment_provider',
      )
      // The service role has no policy to fall back on, so the company id here
      // is the verified one from the membership list, never the cookie.
      .eq('id', org.id)
      .maybeSingle(),
  ]);

  if (!profile) noProfile('payments', error);

  const hasOwnStripeKey = Boolean(keyRow?.stripe_secret_key_enc);
  const vivaConfigured = Boolean(keyRow?.viva_client_id_enc && keyRow?.viva_client_secret_enc);
  const revolutConfigured = Boolean(keyRow?.revolut_secret_key_enc);
  const stripeConfigured = Boolean(hasOwnStripeKey || profile.stripe_account_id);

  const stripeMessage = stripeNotice(t, stripe);

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-500">
        {t.settings.tabIntro.payments}
      </p>

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

      {/* Only worth asking once there is something to choose between. With one
          provider set up the answer is forced, and a dropdown with a single
          real option is a decision the operator does not have to make. */}
      {[stripeConfigured, vivaConfigured, revolutConfigured].filter(Boolean).length > 1 ? (
        <Card>
          <CardHeader title={t.settings.providerTitle} subtitle={t.settings.providerHint} />
          <ProviderChooser
            current={keyRow?.payment_provider ?? null}
            available={{
              stripe: stripeConfigured,
              viva: vivaConfigured,
              revolut: revolutConfigured,
            }}
          />
        </Card>
      ) : null}

      <Card>
        <div id="stripe" className="scroll-mt-20">
          <CardHeader
            title={t.settings.stripe}
            subtitle={t.settings.stripeHint}
            action={
              profile.stripe_account_id ? (
                <Badge tone={profile.stripe_charges_enabled ? 'positive' : 'warning'}>
                  {profile.stripe_charges_enabled
                    ? t.settings.stripeActive
                    : t.settings.stripePending}
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

      <Card>
        <div id="revolut" className="scroll-mt-20">
          <CardHeader
            title={t.settings.revolut}
            subtitle={t.settings.revolutHint}
            action={
              revolutConfigured ? (
                <Badge tone={keyRow?.revolut_environment === 'production' ? 'positive' : 'warning'}>
                  {keyRow?.revolut_environment === 'production'
                    ? t.settings.revolutProduction
                    : t.settings.revolutSandbox}
                </Badge>
              ) : (
                <Badge tone="warning">{t.settings.notConnected}</Badge>
              )
            }
          />
          <RevolutForm
            configured={revolutConfigured}
            environment={keyRow?.revolut_environment ?? 'sandbox'}
          />
        </div>
      </Card>

      <Card>
        <div id="payment-notice" className="scroll-mt-20">
          <CardHeader
            title={t.settings.paymentNotice.title}
            subtitle={t.settings.paymentNotice.hint}
          />
          <PaymentNoticeSwitch enabled={profile.notify_on_payment !== false} />
        </div>
      </Card>
    </div>
  );
}
