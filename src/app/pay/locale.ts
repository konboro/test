import { cache } from 'react';

import type { Locale } from '@/lib/i18n';
import { resolveDebtorLocale, tenantLocale } from '@/lib/i18n/message-locale';
import { payCredentialColumn } from '@/lib/pay-code';
import { createAdminClient } from '@/lib/supabase/admin';

/** Greek, because that is the market the product sells into. */
export const DEFAULT_PAY_LOCALE: Locale = 'el';

/**
 * The language the holder of this payment link is written to in.
 *
 * The customer's own where they have one, otherwise whatever their phone number
 * implies, otherwise the creditor's — the same three steps, in the same order,
 * that decided the language of the reminder that brought them here. Resolving it
 * the same way is the whole point: an English reminder must not land on a Greek
 * page.
 *
 * Memoised for the request. The document language, the tab title and the page
 * body each need it, and without this that is three round-trips for one answer.
 *
 * Falls back rather than failing: a page in the wrong language is bad, and a
 * page that 500s is worse.
 */
export const payLocaleFor = cache(async (credential: string): Promise<Locale> => {
  if (!credential) return DEFAULT_PAY_LOCALE;

  try {
    const admin = createAdminClient();

    const { data: invoice } = await admin
      .from('invoices')
      .select('debtor_id, user_id')
      .eq(payCredentialColumn(credential), credential)
      .maybeSingle();

    if (!invoice) return DEFAULT_PAY_LOCALE;

    const [{ data: debtor }, { data: tenant }] = await Promise.all([
      admin.from('debtors').select('locale, phone').eq('id', invoice.debtor_id).maybeSingle(),
      admin.from('users').select('locale').eq('id', invoice.user_id).maybeSingle(),
    ]);

    const creditorLocale = tenantLocale({ locale: tenant?.locale ?? null });

    return debtor ? resolveDebtorLocale(debtor, creditorLocale) : creditorLocale;
  } catch {
    return DEFAULT_PAY_LOCALE;
  }
});
