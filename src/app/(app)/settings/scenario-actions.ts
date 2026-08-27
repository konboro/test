'use server';

import { revalidatePath } from 'next/cache';

import { DEFAULT_SCENARIO, EXTRA_STEP_OFFSETS, LADDER_STEPS } from '@/lib/dunning/scenario';
import { saveFailed } from '@/lib/errors';
import { getDictionary } from '@/lib/i18n';
import { activeOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CommChannel, DunningStep } from '@/types/database';

export interface ScenarioState {
  error?: string;
  success?: string;
}

/**
 * Bounds mirrored from the migration.
 *
 * The database is where these are enforced — a check constraint cannot be talked
 * past by a future caller. Repeating them here buys a readable message instead of
 * a raw constraint violation, and nothing else. If the two ever disagree, the
 * database wins and the tenant sees an error rather than a cadence nobody agreed
 * to.
 */
const LIMITS = {
  offset: { min: -30, max: 120 },
  repeatEvery: { min: 7, max: 90 },
  repeatMax: { min: 1, max: 6 },
};

// Every slot the ladder can hold. The ones a tenant has not placed arrive
// switched off and are stored that way, so the editor and the engine agree on
// what exists without either of them keeping a second list.
const STEPS: ReadonlyArray<DunningStep> = LADDER_STEPS;

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));

export async function saveScenario(
  _prev: ScenarioState,
  formData: FormData,
): Promise<ScenarioState> {
  const t = await getDictionary();

  // Verified membership, not the cookie: the ladder is written with the service
  // role, and a company id taken on trust would let a hand-edited cookie
  // rewrite someone else's reminder schedule.
  const org = await activeOrganization();
  if (!org) return { error: t.forms.errors.unauthorized };

  const rows = STEPS.map((step) => {
    const channels = formData
      .getAll(`${step}_channels`)
      .map(String)
      .filter((c): c is CommChannel => c === 'email' || c === 'sms');

    const fallback = DEFAULT_SCENARIO.steps.find((s) => s.step === step);
    // A rung the form did not render keeps the day the editor would propose for
    // it rather than collapsing onto the due date, where switching it on later
    // would collide with whatever else sits there.
    const unplaced = EXTRA_STEP_OFFSETS[step] ?? 0;
    const raw = Number(formData.get(`${step}_offset`));

    return {
      user_id: org.id,
      step,
      // A step with no channel is off, not broken. Saying so here keeps the
      // engine from having to guess what an empty channel list meant.
      enabled: formData.get(`${step}_enabled`) === 'on' && channels.length > 0,
      offset_days: clamp(
        Number.isFinite(raw) ? raw : (fallback?.offsetDays ?? unplaced),
        LIMITS.offset,
      ),
      channels: channels.length ? channels : ((fallback?.channels ?? ['email']) as CommChannel[]),
      updated_at: new Date().toISOString(),
    };
  });

  // A reminder that goes out before the due date has to be set before it.
  const preDue = rows.find((r) => r.step === 'pre_due');
  if (preDue && preDue.enabled && preDue.offset_days >= 0) {
    return { error: t.scenario.preDueMustBeBefore };
  }

  // Two steps on the same day would race for one contact slot and the loser
  // would look like a silent failure.
  const active = rows.filter((r) => r.enabled).map((r) => r.offset_days);
  if (new Set(active).size !== active.length) {
    return { error: t.scenario.offsetsMustDiffer };
  }

  const repeatEvery = clamp(Number(formData.get('repeat_every_days')) || 14, LIMITS.repeatEvery);
  const repeatMax = clamp(Number(formData.get('repeat_max')) || 3, LIMITS.repeatMax);

  // Clamped rather than validated away: a stale form or a hand-made request
  // should land on a sane hour, not refuse the whole save of a cadence the
  // operator did mean to change.
  // A missing field parses to NaN, and clamp carries NaN straight through to a
  // column with a 0-23 check constraint — which would fail the whole save. The
  // fallback is the default hour, not zero: midnight is a choice nobody makes.
  const requestedHour = Number(formData.get('send_hour'));
  const sendHour = clamp(
    Number.isFinite(requestedHour) ? requestedHour : DEFAULT_SCENARIO.sendHour,
    { min: 0, max: 23 },
  );

  // The notice sent on issue. Stored beside the rungs because that is where a
  // tenant looks for it, but with no offset: it is not measured from the due
  // date, and the database refuses a non-zero one.
  const issueChannels = formData
    .getAll('on_issue_channels')
    .map(String)
    .filter((c): c is CommChannel => c === 'email' || c === 'sms');

  const issueRow = {
    user_id: org.id,
    step: 'on_issue' as DunningStep,
    enabled: formData.get('on_issue_enabled') === 'on' && issueChannels.length > 0,
    offset_days: 0,
    channels: issueChannels.length
      ? issueChannels
      : (DEFAULT_SCENARIO.onIssue.channels as CommChannel[]),
    updated_at: new Date().toISOString(),
  };

  const admin = createAdminClient();

  const [{ error: stepError }, { error: settingsError }] = await Promise.all([
    admin.from('dunning_steps').upsert([...rows, issueRow], { onConflict: 'user_id,step' }),
    admin.from('dunning_settings').upsert(
      {
        user_id: org.id,
        repeat_enabled: formData.get('repeat_enabled') === 'on',
        repeat_every_days: repeatEvery,
        repeat_max: repeatMax,
        send_hour: sendHour,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
  ]);

  const failure = stepError ?? settingsError;
  if (failure) return { error: saveFailed(t, 'settings:scenario', failure) };

  revalidatePath('/settings');
  revalidatePath('/invoices');

  return { success: t.scenario.saved };
}
