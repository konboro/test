import { athensDate } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

import { chargeDate, chargeReference, periodsDue } from './schedule';

export interface RentRunResult {
  leasesChecked: number;
  /** Charges written on this run. */
  created: number;
  /** Charges that were already there — the normal answer on a second run. */
  existing: number;
  errors: Array<{ leaseId: string; error: string }>;
}

/**
 * Turns leases into the month's rent charges.
 *
 * Runs immediately before the dunning sweep, on the same schedule, because the
 * two belong together: a charge created a minute before the sweep gets its
 * pre-due reminder on the right day, and one created after it would silently
 * wait until tomorrow.
 *
 * Re-running is a no-op, and not by accident. Every charge carries
 * `lease:<id>:<YYYY-MM>` as its external reference, so "has this month already
 * been billed" is a lookup rather than a judgement. That is the same mechanism
 * that makes re-uploading a spreadsheet harmless, reused rather than reinvented.
 *
 * What it deliberately does not do is decide whether rent was *paid*. A
 * generated charge is an ordinary pending invoice: the bank matcher settles it
 * when the transfer arrives, the payment link settles it when the tenant taps,
 * and the ladder chases it until one of those happens. None of that is new code
 * and none of it knows this feature exists.
 */
export async function generateRentCharges(
  options: { userId?: string; today?: string } = {},
): Promise<RentRunResult> {
  const admin = createAdminClient();
  const today = options.today ?? athensDate();

  const result: RentRunResult = { leasesChecked: 0, created: 0, existing: 0, errors: [] };

  let query = admin
    .from('leases')
    .select('id, user_id, debtor_id, property, amount_cents, currency, due_day, starts_on, ends_on, generate_from, active')
    .eq('active', true);

  if (options.userId) query = query.eq('user_id', options.userId);

  const { data: leases, error } = await query;

  if (error) {
    console.error('[leases] reading leases', error);
    result.errors.push({ leaseId: '-', error: error.message });
    return result;
  }

  if (!leases?.length) return result;

  result.leasesChecked = leases.length;

  const candidates = leases.flatMap((lease) =>
    periodsDue(
      {
        dueDay: lease.due_day,
        startsOn: lease.starts_on,
        endsOn: lease.ends_on,
        generateFrom: lease.generate_from,
        active: lease.active,
      },
      today,
    ).map((period) => ({ lease, period, reference: chargeReference(lease.id, period) })),
  );

  if (!candidates.length) return result;

  // Which of these months are already billed.
  //
  // Asked rather than left to `on conflict`: the unique index behind
  // `external_ref` is partial, and Postgres will not use a partial index as a
  // conflict arbiter unless the statement repeats its predicate — which
  // PostgREST cannot send. The import path learned this the hard way.
  const known = new Set<string>();
  const references = candidates.map((c) => c.reference);

  for (let at = 0; at < references.length; at += 200) {
    const { data: seen, error: seenError } = await admin
      .from('invoices')
      .select('external_ref')
      .in('external_ref', references.slice(at, at + 200));

    if (seenError) {
      console.error('[leases] reading existing charges', seenError);
      result.errors.push({ leaseId: '-', error: seenError.message });
      return result;
    }

    for (const row of seen ?? []) {
      if (row.external_ref) known.add(row.external_ref);
    }
  }

  const fresh = candidates.filter((c) => !known.has(c.reference));
  result.existing = candidates.length - fresh.length;

  if (!fresh.length) return result;

  const { data: inserted, error: insertError } = await admin
    .from('invoices')
    .insert(
      fresh.map(({ lease, period, reference }) => {
        const due = chargeDate(period, lease.due_day);

        return {
          user_id: lease.user_id,
          debtor_id: lease.debtor_id,
          amount_cents: lease.amount_cents,
          currency: lease.currency,
          // Rent is owed on the day, not on terms. The scenario's pre-due step
          // is what turns that into "your rent is due on Friday".
          issue_date: due,
          due_date: due,
          status: 'pending' as const,
          source: 'lease' as const,
          external_ref: reference,
          // The flat is the series and the month is the number, so a row reads
          // as "Ερμού 12, Β2 · 2026-08" wherever invoices are listed — which is
          // how a landlord refers to the charge when a tenant queries it.
          series: lease.property,
          invoice_number: period,
        };
      }),
    )
    .select('id');

  if (insertError) {
    console.error('[leases] writing charges', insertError);
    result.errors.push({ leaseId: '-', error: insertError.message });
    return result;
  }

  result.created = inserted?.length ?? 0;

  return result;
}
