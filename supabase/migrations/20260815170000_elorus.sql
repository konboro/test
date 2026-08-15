-- lefta.app — Elorus as the source of record.
--
-- myDATA turned out to be the wrong place to read receivables from. For a
-- retail-facing business it transmits the document but not the counterpart:
-- on the account this was built against, an invoice printed with the customer's
-- name and VAT number reaches AADE with no `counterpart` element at all. It also
-- never transmits a due date, so every imported invoice had one guessed from a
-- fixed "payment terms" setting — and the real terms turned out to be a mix of
-- 0, 7 and 15 days.
--
-- The billing system has all of it: names on every document, an email on most,
-- the real per-document due date, and the myDATA MARK, which lets the two
-- sources be reconciled rather than duplicated.

-- ---------------------------------------------------------------------------
-- credentials
-- ---------------------------------------------------------------------------

alter table public.users
  add column elorus_api_key_enc     text,
  add column elorus_organization_id text,
  add column elorus_last_sync_at    timestamptz;

comment on column public.users.elorus_api_key_enc is
  'AES-256-GCM ciphertext, same envelope as the myDATA key. Never returned to clients.';
comment on column public.users.elorus_organization_id is
  'Sent as the X-Elorus-Organization header, which the Elorus API requires on every request.';

-- The key stays server-side, exactly like the myDATA one: it is deliberately
-- absent from the `authenticated` grant, so even a compromised anon key cannot
-- read the ciphertext.
grant select (elorus_organization_id, elorus_last_sync_at) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- stable ids from the billing system
-- ---------------------------------------------------------------------------
-- Matching on a document number would be wrong: Elorus reuses `number` across
-- numbering sequences — two documents in this account are both "42" — so the
-- opaque id is the only safe key.

alter table public.debtors  add column elorus_contact_id text;
alter table public.invoices add column elorus_invoice_id text;

create unique index debtors_user_elorus_uniq
  on public.debtors (user_id, elorus_contact_id)
  where elorus_contact_id is not null;

create unique index invoices_user_elorus_uniq
  on public.invoices (user_id, elorus_invoice_id)
  where elorus_invoice_id is not null;

-- `source` gains a third value. Documents can arrive from either system and are
-- reconciled on the MARK, so this records which one actually created the row.
alter table public.invoices drop constraint if exists invoices_source_check;
alter table public.invoices
  add constraint invoices_source_check check (source in ('mydata', 'manual', 'elorus'));
