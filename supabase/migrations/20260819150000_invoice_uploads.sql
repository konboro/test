-- lefta.app — invoices arriving as a file rather than as a feed
--
-- myDATA and Elorus deliver invoices already structured, and where they are
-- connected they stay the better source: they are authoritative, free, and no
-- reading of a document can beat the document's own issuer. This exists for what
-- they cannot answer — history from before myDATA, foreign customers, and the
-- tenant who arrives with a folder of PDFs and nothing connected at all.
--
-- Deliberately a staging table, not a fast path into `invoices`. Everything this
-- product does with an invoice ends in a demand for money, so an extraction that
-- misreads an amount does not produce an untidy row, it produces a letter
-- chasing the wrong person for the wrong sum. Rows here are proposals; a person
-- confirms them, and only then does an invoice exist.

create table public.invoice_uploads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,

  -- Where the file lives in the private bucket below. Kept even after the
  -- invoice is created: a disputed reminder is answered by producing the
  -- document it was based on.
  storage_path  text not null,
  filename      text not null,
  mime_type     text not null,
  size_bytes    integer not null,

  -- How the fields below were obtained. 'pdf_text' is the embedded text layer of
  -- a generated PDF and is exact; 'vision' is a reading of a scan and is not;
  -- 'manual' means a person typed it after we failed. Worth storing: it is the
  -- difference between a field to trust and a field to check.
  source        text not null check (source in ('pdf_text', 'vision', 'manual')),

  -- The proposal. Free-form on purpose — the reviewer edits it before it becomes
  -- an invoice, and pinning a column per field would make every new field a
  -- migration.
  extracted     jsonb not null default '{}'::jsonb,

  -- Fields we could not find, so the review screen can point at them rather than
  -- presenting a confident blank.
  missing       text[] not null default '{}',

  status        text not null default 'pending'
                check (status in ('pending', 'committed', 'discarded')),

  -- Set when the reviewer confirms. Null while the proposal is still a proposal.
  invoice_id    uuid references public.invoices(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index invoice_uploads_user_idx on public.invoice_uploads (user_id, created_at desc);

-- The review queue is the only list anyone browses, and it is a small slice of
-- a table that grows with every file ever uploaded.
create index invoice_uploads_pending_idx on public.invoice_uploads (user_id, created_at desc)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Read by the owning tenant. Every write goes through a server action under the
-- service role, which is what lets the extraction and the commit run as one
-- checked operation rather than as whatever the browser felt like sending.

alter table public.invoice_uploads enable row level security;

create policy invoice_uploads_select_own on public.invoice_uploads
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.invoice_uploads from anon, authenticated;
revoke all on public.invoice_uploads from anon;

-- ---------------------------------------------------------------------------
-- the bucket
-- ---------------------------------------------------------------------------
-- Private, and with no policy granting `authenticated` anything. Files are
-- written by the upload action and read back through short-lived signed URLs,
-- both under the service role, so there is no path by which one tenant can name
-- another tenant's object and be handed it.
--
-- An invoice names a person or a company and what they owe. That is personal
-- data belonging to someone who never signed up to this platform, and a bucket
-- that is public "just to make previews easier" is how it ends up indexed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-uploads',
  'invoice-uploads',
  false,
  20971520, -- 20 MB; a scanned multi-page invoice, with room to spare
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
