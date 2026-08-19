-- lefta.app — every Viva order we mint, not just the latest one
--
-- The return route can only settle what it can resolve, and until now the only
-- link between an order code and an invoice was `invoices.viva_order_code` — a
-- single column that every press of the Pay button overwrote. Two tabs, a slow
-- checkout, an impatient debtor: order 1 gets paid, the column already says
-- order 2, the lookup finds nothing and the money lands unsettled.
--
-- Orders are cheap and immutable, so they get their own append-style table.
-- The invoice column stays — it is still written as "the latest order", the
-- timeline reads it, and it is the fallback for the deploy-before-migration
-- window — but resolution no longer depends on it alone.
--
-- `amount_cents` is copied at minting time. The order is created from the
-- stored amount and Viva charges exactly that, so recording it here is what
-- lets settlement write down the amount that was actually charged even if the
-- invoice row was corrected (an Elorus sync, a manual edit) while the checkout
-- sat open.

create table public.viva_orders (
  order_code   text primary key,
  user_id      uuid not null references public.users (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  created_at   timestamptz not null default now()
);

create index viva_orders_invoice_idx on public.viva_orders (invoice_id, created_at desc);

-- Server-side bookkeeping only: written when a payment starts, read when the
-- debtor returns. No browser role has any business here.
alter table public.viva_orders enable row level security;
revoke all on public.viva_orders from anon, authenticated;
