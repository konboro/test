import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, EmptyState, linkClass } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { Dropzone } from './dropzone';
import { ReviewCard, type Proposal } from './review-card';
import { loadScenario } from '@/lib/dunning/engine';
import { requireOrganization } from '@/lib/orgs/active';

export async function generateMetadata() {
  return { title: (await getDictionary()).upload.title };
}

export const dynamic = 'force-dynamic';

/** Long enough to read a document, short enough not to be a shareable link. */
const SIGNED_URL_SECONDS = 300;

/** Cents back into the notation the operator types and the document shows. */
function decimal(cents: unknown): string | null {
  return typeof cents === 'number' ? (cents / 100).toFixed(2).replace('.', ',') : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export default async function UploadPage() {
  const t = await getDictionary();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // What the choice beside each reading starts from.
  const org = await requireOrganization();
  const scenario = await loadScenario(org.id);

  // RLS already confines this to the tenant; the read goes through the session
  // client precisely so that it does.
  const { data: rows } = await supabase
    .from('invoice_uploads')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);

  // The bucket is private and stays that way: each card gets a short-lived
  // signed URL minted here rather than a path the browser could ask for.
  const admin = createAdminClient();

  const proposals: Proposal[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data: signed } = await admin.storage
        .from('invoice-uploads')
        .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);

      const extracted = (row.extracted ?? {}) as Record<string, unknown>;

      return {
        id: row.id,
        filename: row.filename,
        source: row.source,
        missing: row.missing ?? [],
        problem: text(extracted.problem),
        fileUrl: signed?.signedUrl ?? null,
        fields: {
          debtorName: text(extracted.debtorName),
          vatNumber: text(extracted.vatNumber),
          invoiceNumber: text(extracted.invoiceNumber),
          issueDate: text(extracted.issueDate),
          dueDate: text(extracted.dueDate),
          amount: decimal(extracted.amountCents),
          // What the document was written in, so the reviewer sees the reader's
          // answer rather than inheriting it unseen.
          currency: text(extracted.currency),
          // Read off the document like everything else. Without one of these
          // nothing can ever be sent about the invoice, so making somebody
          // retype what the page already says is the worst kind of blank.
          email: text(extracted.email),
          phone: text(extracted.phone),
        },
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className={`text-sm ${linkClass}`}>
          ← {t.nav.invoices}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
          {t.upload.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">{t.upload.subtitle}</p>
      </div>

      <Card>
        <Dropzone />
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t.upload.queue}
        </h2>

        {proposals.length === 0 ? (
          <Card>
            <EmptyState title={t.upload.queueEmpty} body={t.upload.queueEmptyHint} />
          </Card>
        ) : (
          proposals.map((proposal) => <ReviewCard key={proposal.id} proposal={proposal} scenario={scenario} />)
        )}
      </section>
    </div>
  );
}
