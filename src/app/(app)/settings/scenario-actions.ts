'use server';

import { revalidatePath } from 'next/cache';

import { DEFAULT_SCENARIO } from '@/lib/dunning/scenario';
import { getDictionary } from '@/lib/i18n';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/server';
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

const STEPS: DunningStep[] = ['pre_due', 'overdue_2', 'overdue_10'];

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));

export async function saveScenario(
  _prev: ScenarioState,
  formData: FormData,
): Promise<ScenarioState> {
  const t = await getDictionary();

  const user = await getSessionUser();
  if (!user) return { error: t.forms.errors.unauthorized };

  const rows = STEPS.map((step) => {
    const channels = formData
      .getAll(`${step}_channels`)
      .map(String)
      .filter((c): c is CommChannel => c === 'email' || c === 'sms');

    const fallback = DEFAULT_SCENARIO.steps.find((s) => s.step === step);
    const raw = Number(formData.get(`${step}_offset`));

    return {
      user_id: user.id,
      step,
      // A step with no channel is off, not broken. Saying so here keeps the
      // engine from having to guess what an empty channel list meant.
      enabled: formData.get(`${step}_enabled`) === 'on' && channels.length > 0,
      offset_days: clamp(Number.isFinite(raw) ? raw : (fallback?.offsetDays ?? 0), LIMITS.offset),
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

  const admin = createAdminClient();

  const [{ error: stepError }, { error: settingsError }] = await Promise.all([
    admin.from('dunning_steps').upsert(rows, { onConflict: 'user_id,step' }),
    admin.from('dunning_settings').upsert(
      {
        user_id: user.id,
        repeat_enabled: formData.get('repeat_enabled') === 'on',
        repeat_every_days: repeatEvery,
        repeat_max: repeatMax,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
  ]);

  const failure = stepError ?? settingsError;
  if (failure) return { error: failure.message };

  revalidatePath('/settings');
  revalidatePath('/invoices');

  return { success: t.scenario.saved };
}
