import { Card, CardHeader } from '@/components/ui';
import { loadScenario } from '@/lib/dunning/engine';
import { stepLabels } from '@/lib/dunning/status';
import { defaultTemplateFor, EDITABLE_SLOTS, slotKey } from '@/lib/dunning/templates';
import { getDictionary, getLocale } from '@/lib/i18n';
import { smsCreditsEnforced } from '@/lib/limits';
import { channelAvailable, paymentsAvailable } from '@/lib/providers';
import { SMS_PACKS } from '@/lib/stripe';

import { noProfile, settingsAccess } from '../access';
import { AutomationSwitch } from '../automation-switch';
import { ChannelSwitches } from '../channel-switches';
import { ScanRules, type ScanRuleView } from '../scan-rules';
import { ScenarioForm } from '../scenario-forms';
import { CreditPacks } from '../settings-forms';
import { TemplateEditor, type TemplateSlotView } from '../template-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).settings.tabs.reminders };
}
export const dynamic = 'force-dynamic';

/**
 * What goes out, when, and in whose words.
 *
 * The SMS meter lives here rather than under the company, because what it
 * governs is on this screen: a ladder with an SMS rung on it is a ladder that
 * stops when the credits do.
 */
export default async function RemindersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ credits?: string }>;
}) {
  const { credits } = await searchParams;
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const { supabase, org } = await settingsAccess();

  const { data: profile, error } = await supabase
    .from('users')
    .select('automation_enabled, email_enabled, sms_enabled, sms_credits')
    .eq('id', org.id)
    .maybeSingle();

  if (!profile) noProfile('reminders', error);

  // Independent reads, so they go together. The page these were lifted out of
  // awaited fourteen of them one after another.
  const [{ count: openInvoices }, scenario, { data: scanRules }, { data: templates }] =
    await Promise.all([
      // What the confirmation is actually asking about. A switch that warns
      // "reminders will start going out" is abstract; the same warning naming a
      // number is the difference between a setting and a decision.
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      loadScenario(org.id),
      // Everything still to be decided, and everything decided in favour.
      // Rejected and withdrawn rules stay in the table as the record and are
      // not listed.
      supabase
        .from('scan_rules')
        .select('id, status, signature_parts, payload, seen_count')
        .in('status', ['proposed', 'approved'])
        .order('status', { ascending: true })
        .order('updated_at', { ascending: false })
        .limit(50),
      // RLS scopes this to the tenant. A slot with no row keeps the built-in copy.
      supabase.from('message_templates').select('step, channel, variant, subject, body'),
    ]);

  const scanRuleViews: ScanRuleView[] = (scanRules ?? []).map((rule) => {
    const payload = rule.payload as {
      field?: string;
      wrong?: string | null;
      right?: string | null;
      context?: string[];
    };

    return {
      id: rule.id,
      status: rule.status === 'approved' ? 'approved' : 'proposed',
      parts: rule.signature_parts ?? [],
      field: payload.field ?? '—',
      wrong: payload.wrong ?? null,
      right: payload.right ?? null,
      context: payload.context ?? [],
      seenCount: rule.seen_count,
    };
  });

  // `variant` has to come back and has to reach slotKey, because a variant is
  // part of a slot's identity: without it a named wording — the personal-debtor
  // email, step null, variant 'penny' — keys to the same `manual:email` as the
  // plain manual template. Two rows, one key, last one wins. The editor then
  // showed one slot's text under the other's heading, and pressing Save there
  // wrote it over the template the operator had not been looking at.
  //
  // Not `t` — that is the dictionary in this scope.
  const overrides = new Map(
    (templates ?? []).map((row) => [
      slotKey(row.step, row.channel, row.variant === 'penny' ? 'penny' : null),
      row,
    ]),
  );

  // A rung's heading is its position in the ladder, which the app can say in
  // the reader's language; only the named wordings carry a label of their own.
  const stepName = stepLabels(t);

  // The wordings that are not rungs. Their names were baked into the slot list
  // in Greek, which is what an English tenant was reading.
  const slotName = (key: string) =>
    key === 'manual:email'
      ? t.templates.slotManualEmail
      : key === 'manual:sms'
        ? t.templates.slotManualSms
        : key === 'penny:email'
          ? t.templates.slotPennyEmail
          : key;
  const channelName = (channel: 'email' | 'sms') => (channel === 'email' ? 'email' : 'SMS');

  const slots: TemplateSlotView[] = EDITABLE_SLOTS.map((slot) => {
    const override = overrides.get(slot.key);
    // The default shown is the one in the reader's language, not the Greek copy
    // every tenant used to be shown regardless of which language they work in.
    const fallback = defaultTemplateFor(slot.key, locale);

    return {
      key: slot.key,
      label: slot.step
        ? `${stepName[slot.step]} (${channelName(slot.channel)})`
        : slotName(slot.key),
      channel: slot.channel,
      subject: override?.subject ?? fallback.subject,
      body: override?.body ?? fallback.body,
      customised: Boolean(override),
    };
  });

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed text-ink-500">
        {t.settings.tabIntro.reminders}
      </p>

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

      <Card>
        <div id="automation" className="scroll-mt-20">
          <CardHeader
            title={t.settings.automation.title}
            subtitle={t.settings.automation.subtitle}
          />
          <AutomationSwitch enabled={profile.automation_enabled} openInvoices={openInvoices ?? 0} />

          <div className="border-t border-ink-100 px-5 pt-4">
            <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
              {t.settings.channels.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{t.settings.channels.hint}</p>
          </div>
          <ChannelSwitches
            emailEnabled={profile.email_enabled}
            smsEnabled={profile.sms_enabled}
            masterOn={profile.automation_enabled}
            emailAvailable={channelAvailable('email')}
            smsAvailable={channelAvailable('sms')}
          />
        </div>
      </Card>

      {/* What the reader is asking to be taught. Above the scenario because a
          proposal waits on a person, and a thing waiting on you belongs where
          you will see it. */}
      <Card>
        <div id="scan-rules" className="scroll-mt-20">
          <CardHeader title={t.scanRules.title} subtitle={t.scanRules.hint} />
          <ScanRules rules={scanRuleViews} />
        </div>
      </Card>

      <Card>
        <div id="scenario" className="scroll-mt-20">
          <CardHeader title={t.scenario.title} subtitle={t.scenario.hint} />
          <ScenarioForm scenario={scenario} />
        </div>
      </Card>

      <Card>
        <div id="templates" className="scroll-mt-20">
          <CardHeader title={t.settings.templatesTitle} subtitle={t.settings.templatesHint} />
          <TemplateEditor slots={slots} />
        </div>
      </Card>

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
    </div>
  );
}
