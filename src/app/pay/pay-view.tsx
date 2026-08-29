import { notFound } from 'next/navigation';

import { LeftaLogo, LeftaWordmark } from '@/components/logo';
import { dictionaryFor, type Dictionary } from '@/lib/i18n';
import { resolveDebtorLocale, tenantLocale } from '@/lib/i18n/message-locale';
import { formatDate, formatMoney } from '@/lib/money';
import { createAdminClient } from '@/lib/supabase/admin';

import { FunnelBeacon } from './beacon';
import { PayButton } from './pay-button';
import { ReportLinks } from './report-links';

/**
 * Public payment page for the debtor.
 *
 * Rendered by both entry points — the short `lefta.app/<code>` link and the
 * long `/pay/<token>` one that older reminders carry. The credential is the only
 * thing the visitor holds, and the page deliberately shows the minimum needed to
 * recognise and settle the document — no debtor list, no tenant data, no other
 * invoices.
 */
export async function PayView({ credential, paid }: { credential: string; paid: boolean }) {
  // `get_invoice_for_payment` is a security-definer function exposing exactly
  // these columns, so the invoices table itself stays closed to anonymous reads.
  // It matches either credential, which is what keeps old links alive.
  const { data, error } = await createAdminClient().rpc('get_invoice_for_payment', {
    p_token: credential,
  });

  const invoice = data?.[0];
  if (error || !invoice) notFound();

  // The scan this invoice was read from, if there was one.
  //
  // Signed here rather than behind a route: whoever is looking at this page has
  // already presented the payment credential, so there is nothing further to
  // check, and a debtor being asked for money is entitled to see the document
  // the demand is based on. The URL expires; the bucket stays private.
  const documentUrl = await payableDocumentUrl(invoice.invoice_id);

  // The language the reminder was written in, resolved the same way, so the
  // message and the page it links to speak to the customer alike. An English
  // reminder landing on a Greek-only page was the one place in the product
  // where the language setting stopped short of the person it is for.
  const t = (await payLocale(invoice.invoice_id)).pay;

  const settled = invoice.status === 'paid';
  const payable = invoice.status === 'pending';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <FunnelBeacon credential={credential} />
      <div className="w-full max-w-md">
        {/* The mark, not just the word. This is the most-branded surface the
            product has — a debtor arriving from an email needs to recognise
            where they landed before they read anything else. */}
        <div className="flex justify-center">
          <LeftaLogo />
        </div>
        <p className="mt-3 text-center text-sm text-ink-500">
          {t.payTo} <span className="font-medium text-ink-800">{invoice.creditor_name}</span>
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lg shadow-ink-900/5">
          {/* The money-path accent: the same brand blue as the button in the
              reminder email, so the page reads as the message's continuation. */}
          <div aria-hidden="true" className="h-1 bg-brand-600" />

          <div className="border-b border-ink-200 px-6 pb-6 pt-7 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {t.amountDue}
            </p>
            <p className="mt-2 text-5xl font-semibold leading-none tracking-tight text-ink-900">
              {formatMoney(invoice.amount_cents, invoice.currency)}
            </p>
          </div>

          <dl className="divide-y divide-ink-100 text-sm">
            <Row
              label={t.invoice}
              value={invoice.invoice_number ?? '—'}
              href={invoice.invoice_number ? (documentUrl ?? undefined) : undefined}
            />
            <Row label={t.company} value={invoice.debtor_name} />
            <Row label={t.issueDate} value={formatDate(invoice.issue_date)} />
            <Row label={t.dueDate} value={formatDate(invoice.due_date)} />
          </dl>

          <div className="border-t border-ink-200 bg-ink-50/50 px-6 py-6">
            {settled || paid ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <CheckIcon />
                {settled ? (
                  <>
                    <p className="mt-2 font-medium">{t.settledTitle}</p>
                    <p className="mt-1 text-xs">{t.settledBody}</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 font-medium">{t.recordingTitle}</p>
                    <p className="mt-1 text-xs">{t.recordingBody}</p>
                  </>
                )}
              </div>
            ) : payable && invoice.payments_enabled ? (
              <>
                <PayButton token={credential} t={t} />
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-ink-500">
                  <LockIcon />
                  {t.secure}
                </p>
                {/* The exits for whoever is NOT paying right now: already paid
                    by transfer, or the document is wrong. Both used to be dead
                    ends that earned the visitor another reminder. */}
                <ReportLinks token={credential} t={t} />
              </>
            ) : payable ? (
              // The creditor has neither a connected account nor their own key.
              // The document details above still stand — a reminder link must
              // never dead-end on a button that breaks when pressed. The report
              // links matter even more here: with no button at all, "I paid by
              // transfer" is the page's most likely true story.
              <>
                <div className="rounded-xl bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                  {t.noOnlinePayment}
                </div>
                <ReportLinks token={credential} t={t} />
              </>
            ) : (
              <div className="rounded-xl bg-ink-100 px-4 py-3 text-center text-sm text-ink-600">
                {t.notPayable}
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          {t.footerBefore}{' '}
          <LeftaWordmark className="text-ink-700" />{' '}
          {t.footerAfter(invoice.creditor_name)}
        </p>
      </div>
    </main>
  );
}

/** Greek, because that is the market the product sells into. */
const DEFAULT_PAY_LOCALE = 'el' as const;

/**
 * The dictionary this page should speak in.
 *
 * The customer's own language where they have one, otherwise whatever their
 * phone number implies, otherwise the creditor's — the same three steps, in the
 * same order, that decide the language of the reminder. Falls back rather than
 * failing: a page that cannot be read is bad, and a page that 500s is worse.
 */
export async function payLocale(invoiceId: string): Promise<Dictionary> {
  const admin = createAdminClient();

  try {
    const { data: row } = await admin
      .from('invoices')
      .select('debtor_id, user_id')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!row) return dictionaryFor(DEFAULT_PAY_LOCALE);

    const [{ data: debtor }, { data: tenant }] = await Promise.all([
      admin.from('debtors').select('locale, phone').eq('id', row.debtor_id).maybeSingle(),
      admin.from('users').select('locale').eq('id', row.user_id).maybeSingle(),
    ]);

    const creditorLocale = tenantLocale({ locale: tenant?.locale ?? null });

    return dictionaryFor(
      debtor ? resolveDebtorLocale(debtor, creditorLocale) : creditorLocale,
    );
  } catch {
    return dictionaryFor(DEFAULT_PAY_LOCALE);
  }
}

/**
 * The metadata for both entry points.
 *
 * `generateMetadata` runs before the body and holds only the credential, so the
 * invoice is resolved once more here. Two small reads on a page a debtor opens
 * from an email is a fair price for a tab title they can read — and a failure
 * falls back to the default rather than taking the page down with it.
 */
export async function payMetadata(credential: string) {
  return {
    title: (await payCopyFor(credential)).metaTitle,
    // This page names a debtor and what they owe. Indexed, it would publish a
    // private debt to anyone searching that person's name — and `nocache` keeps
    // it out of the cached copy a delisting would otherwise leave behind.
    robots: { index: false, follow: false, nocache: true },
  };
}

async function payCopyFor(credential: string) {
  try {
    const { data } = await createAdminClient().rpc('get_invoice_for_payment', {
      p_token: credential,
    });

    const invoiceId = data?.[0]?.invoice_id;
    if (!invoiceId) return dictionaryFor(DEFAULT_PAY_LOCALE).pay;

    return (await payLocale(invoiceId)).pay;
  } catch {
    return dictionaryFor(DEFAULT_PAY_LOCALE).pay;
  }
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    // A company name with no spaces in it was setting the width of the card and
    // pushing the page sideways on a phone.
    <div className="flex items-start justify-between gap-4 px-5 py-3 sm:px-6">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="tabular min-w-0 break-words text-right font-medium text-ink-900">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-ink-300 underline-offset-2 hover:decoration-ink-900"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mx-auto h-6 w-6 text-emerald-600"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 12.3l2.6 2.7L16 9.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Fifteen minutes: long enough to open and read, not long enough to circulate. */
const DOCUMENT_URL_SECONDS = 900;

async function payableDocumentUrl(invoiceId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from('invoice_uploads')
    .select('storage_path')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!upload) return null;

  const { data: signed } = await admin.storage
    .from('invoice-uploads')
    .createSignedUrl(upload.storage_path, DOCUMENT_URL_SECONDS);

  return signed?.signedUrl ?? null;
}
