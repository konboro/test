import { NextResponse, type NextRequest } from 'next/server';

import { activeOrganization } from '@/lib/orgs/active';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The scan an invoice was created from.
 *
 * Minted on demand rather than rendered into the list. The invoices screen shows
 * up to five hundred rows; signing a URL for every one of them that happens to
 * have a document would be five hundred round-trips to produce links almost
 * nobody clicks.
 *
 * The bucket stays private. This hands back a redirect to a short-lived signed
 * URL, and the only thing that decides whether it does so is whether the invoice
 * belongs to the company the caller is acting for.
 */

/** Long enough to open and read, short enough not to become a shared link. */
const SIGNED_URL_SECONDS = 900;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const org = await activeOrganization();
  if (!org) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Ownership is checked here because the service role below has no policy to
  // fall back on: the invoice must belong to the company being acted for, not
  // merely exist.
  const { data: upload } = await admin
    .from('invoice_uploads')
    .select('storage_path, user_id, filename')
    .eq('invoice_id', id)
    .eq('user_id', org.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!upload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: signed, error } = await admin.storage
    .from('invoice-uploads')
    .createSignedUrl(upload.storage_path, SIGNED_URL_SECONDS);

  if (error || !signed) {
    console.error('[invoice:document]', error?.message);
    return NextResponse.json({ error: 'Unavailable' }, { status: 502 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
