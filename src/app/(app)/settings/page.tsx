import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader } from '@/components/ui';
import { LADDER } from '@/lib/dunning/engine';

import { DEFAULT_TEMPLATES, EDITABLE_SLOTS, slotKey } from '@/lib/dunning/templates';
import { DICTIONARIES } from '@/lib/i18n/dictionaries';
import { getDictionary, LOCALES } from '@/lib/i18n';
import { connectConfigured, SMS_PACKS } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import type { DunningStep } from '@/types/database';

import { updateLocale } from './actions';
import { ElorusForm } from './elorus-forms';
import { CreditPacks, MyDataForm, ProfileForm } from './settings-forms';
import { StripeConnect } from './stripe-forms';
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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ credits?: string; stripe?: string }>;
}) {
  const { credits, stripe } = await searchParams;
  const t = await getDictionary();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select(
      'company_name, vat_number, reply_to_email, default_payment_terms_days, automation_enabled, mydata_user_id, mydata_environment, sms_credits, stripe_account_id, stripe_charges_enabled, locale, elorus_organization_id',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/login');

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
          />
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
