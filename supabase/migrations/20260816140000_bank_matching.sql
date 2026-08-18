-- lefta.app — bank feed and settlement matching
--
-- Most Greek invoices are settled by transfer, not by card. Today that payment
-- only becomes visible when a human records it — in Elorus, or by pressing
-- "paid" in the panel — and until they do, the ladder keeps chasing a customer
-- who has already paid. myDATA carries no payment status at all, so a tenant
-- without Elorus has no other signal.
--
-- Reading the creditor's own bank feed closes that gap to a day.

-- ---------------------------------------------------------------------------
-- connections
-- ---------------------------------------------------------------------------
-- One row per bank account a creditor has linked through the account
-- information provider.
--
-- Consent is finite and we choose its length at authorisation time, capped by
-- the bank: the Greek banks currently allow 180 days. When it lapses the feed
-- simply stops returning data — no error, no callback, nothing. So
-- `consent_expires_at` is a first-class column: the panel warns on it and the
-- sweep retires the connection rather than reporting an empty statement.

create table public.bank_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,

  institution_id     text not null,
  institution_name   text not null,

  -- The provider's handles. Both stay null until the creditor comes back from
  -- their bank and the authorisation resolves to an account.
  authorization_id   text,
  account_id         text,

  status             text not null default 'pending'
                       check (status in ('pending', 'active', 'expired', 'revoked')),
  consent_expires_at timestamptz,
  last_synced_at     timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index bank_connections_account_uniq
  on public.bank_connections (user_id, account_id)
  where account_id is not null;

create index bank_connections_user_idx on public.bank_connections (user_id, status);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
-- Only credits are stored. A creditor's outgoing payments are none of this
-- product's business and would be the most sensitive data in the table.

create table public.bank_transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  connection_id      uuid not null references public.bank_connections(id) on delete cascade,

  -- The provider's own id for the transaction. Ingest is idempotent on this and
  -- nothing else: the same statement is fetched again every single day.
  provider_tx_id     text not null,

  booked_on          date not null,
  amount_cents       bigint not null check (amount_cents > 0),
  currency           text not null,

  remittance         text,
  counterparty_name  text,
  counterparty_iban  text,

  state              text not null default 'unmatched'
                       check (state in ('unmatched', 'review', 'settled', 'dismissed')),

  matched_invoice_id uuid references public.invoices(id) on delete set null,
  -- Which evidence fired: 'reference', 'name', 'iban'. Kept because a liberal
  -- matching threshold is only defensible if every decision can be shown.
  match_signals      text[] not null default '{}',
  matched_at         timestamptz,
  -- Null when the match was automatic; the operator's id when confirmed by hand.
  matched_by         uuid references public.users(id) on delete set null,

  -- Pairs an operator has already rejected, so an undone match is never
  -- proposed a second time.
  rejected_invoice_ids uuid[] not null default '{}',

  created_at         timestamptz not null default now()
);

create unique index bank_transactions_provider_uniq
  on public.bank_transactions (connection_id, provider_tx_id);

create index bank_transactions_queue_idx on public.bank_transactions (user_id, state, booked_on desc);
create index bank_transactions_invoice_idx on public.bank_transactions (matched_invoice_id)
  where matched_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Readable by the tenant, written only by the sweep under the service role.
-- Confirming or undoing a match goes through a server action that re-checks
-- ownership, exactly as `invoices/actions.ts` does for its own bypass.

alter table public.bank_connections enable row level security;
alter table public.bank_transactions enable row level security;

create policy bank_connections_select_own on public.bank_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bank_transactions_select_own on public.bank_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.bank_connections from anon, authenticated;
revoke insert, update, delete on public.bank_transactions from anon, authenticated;

-- The feed names people who are not this platform's users — whoever paid the
-- creditor, including private individuals. Nothing here is readable by `anon`.
revoke all on public.bank_connections from anon;
revoke all on public.bank_transactions from anon;
