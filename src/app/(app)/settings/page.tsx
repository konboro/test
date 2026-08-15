import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader } from '@/components/ui';
import { LADDER } from '@/lib/dunning/engine';
import { STEP_LABELS } from '@/lib/dunning/status';
import { DEFAULT_TEMPLATES, EDITABLE_SLOTS, slotKey } from '@/lib/dunning/templates';
import { SMS_PACKS } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';

import { CreditPacks, MyDataForm, ProfileForm } from './settings-forms';
import { TemplateEditor, type TemplateSlotView } from './template-forms';

export const metadata = { title: 'Ρυθμίσεις — lefta.app' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ credits?: string }>;
}) {
  const { credits } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select(
      'company_name, vat_number, reply_to_email, default_payment_terms_days, automation_enabled, mydata_user_id, mydata_environment, sms_credits',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/login');

  // RLS scopes this to the tenant. A slot with no row keeps the built-in copy.
  const { data: templates } = await supabase
    .from('message_templates')
    .select('step, channel, subject, body');

  const overrides = new Map((templates ?? []).map((t) => [slotKey(t.step, t.channel), t]));

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
        <h1 className="text-xl font-semibold text-ink-900">Ρυθμίσεις</h1>
        <p className="mt-0.5 text-sm text-ink-500">Στοιχεία επιχείρησης, myDATA και SMS.</p>
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

      <Card>
        <CardHeader title="Στοιχεία επιχείρησης" />
        <ProfileForm profile={profile} />
      </Card>

      <Card>
        <CardHeader
          title="Σύνδεση myDATA (ΑΑΔΕ)"
          subtitle="Το Subscription Key αποθηκεύεται κρυπτογραφημένο (AES-256-GCM) και δεν επιστρέφεται ποτέ στον browser."
          action={
            profile.mydata_user_id ? (
              <Badge tone="positive">Συνδεδεμένο</Badge>
            ) : (
              <Badge tone="warning">Μη συνδεδεμένο</Badge>
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
            title="Υπόλοιπο SMS"
            subtitle="Ένα SMS καταναλώνεται ανά απεσταλμένο μήνυμα. Τα email είναι απεριόριστα."
            action={
              <span className="tabular text-sm font-semibold text-ink-900">
                {profile.sms_credits} διαθέσιμα
              </span>
            }
          />
          <CreditPacks packs={SMS_PACKS} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Κείμενα μηνυμάτων"
          subtitle="Το περιεχόμενο είναι δικό σας. Το πλαίσιο του email (κουμπί πληρωμής και υποσέλιδο πλατφόρμας) παραμένει σταθερό."
        />
        <TemplateEditor slots={slots} />
      </Card>

      <Card>
        <CardHeader
          title="Ροή υπενθυμίσεων"
          subtitle="Ο χρονισμός είναι σταθερός και μη παραμετροποιήσιμος — παραμετροποιήσιμο είναι μόνο το κείμενο. Το lefta.app λειτουργεί αποκλειστικά ως πάροχος λογισμικού."
        />
        <ol className="divide-y divide-ink-100">
          {LADDER.map((rung) => (
            <li key={rung.step} className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-ink-900">{STEP_LABELS[rung.step]}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {rung.offsetFrom < 0
                    ? `${Math.abs(rung.offsetFrom)} ημέρες πριν τη λήξη`
                    : `${rung.offsetFrom} ημέρες μετά τη λήξη`}
                </p>
              </div>
              <div className="flex gap-1.5">
                {rung.channels.map((channel) => (
                  <Badge key={channel} tone={channel === 'sms' ? 'info' : 'neutral'}>
                    {channel === 'sms' ? 'SMS' : 'Email'}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-ink-100 bg-ink-50 px-5 py-4 text-xs leading-relaxed text-ink-600">
          <p>
            <strong className="font-semibold text-ink-800">Όριο συχνότητας:</strong> κάθε πελάτης
            λαμβάνει το πολύ <strong>μία επαφή ανά ημερολογιακή ημέρα</strong>, ανεξάρτητα από το
            πλήθος των ανεξόφλητων παραστατικών του. Το όριο επιβάλλεται στη βάση δεδομένων.
          </p>
          <p className="mt-2">
            <strong className="font-semibold text-ink-800">Αυτόματη διακοπή:</strong> μόλις ένα
            παραστατικό σημανθεί ως εξοφλημένο, η ροή σταματά αμέσως για αυτό.
          </p>
        </div>
      </Card>
    </div>
  );
}
