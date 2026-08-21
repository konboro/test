-- lefta.app — rent, entered once instead of every month
--
-- A landlord does not issue invoices. They agree a rent, a day of the month and
-- a tenant, and then the same amount is owed on the same day until somebody
-- moves out. Asking them to create a document every month is asking them to do
-- the product's job by hand, and the month they forget is the month the rent is
-- late with nothing chasing it.
--
-- So the lease is the thing they enter, and the charge is derived. Everything
-- downstream — the ladder, the payment link, the daily contact limit, the
-- snooze — already works on invoices, so a generated charge is an ordinary
-- invoice and inherits all of it without a line of new logic.

create table public.leases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  debtor_id    uuid not null references public.debtors (id) on delete cascade,

  -- What the landlord calls the place. Free text on purpose: "Ερμού 12, Β2" is
  -- how they think of it, and no address schema survives contact with the way
  -- people actually name their own flats.
  property     text not null check (length(btrim(property)) > 0),

  amount_cents integer not null check (amount_cents > 0),
  currency     text not null default 'EUR',

  -- 1–31, clamped to the month's last day when generating. A lease that says
  -- "the 31st" is due on the 28th of February, which is what everyone means and
  -- what nobody writes down.
  due_day      smallint not null check (due_day between 1 and 31),

  starts_on    date not null,
  ends_on      date,

  -- The first month this lease may bill for, and the guard that stops a decade
  -- of back rent appearing at once.
  --
  -- A landlord entering a lease that began in 2023 wants the product to take
  -- over from today, not to invent thirty-two overdue charges and set the
  -- ladder chasing a tenant for rent that was paid in cash years ago. Defaults
  -- to the current month at insert; a landlord who genuinely wants arrears can
  -- move it back deliberately.
  generate_from date not null,

  active       boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint leases_ends_after_start check (ends_on is null or ends_on >= starts_on)
);

comment on table public.leases is
  'A recurring rent agreement. Charges are derived from it monthly; the lease itself is never billed.';

create index leases_user_active_idx on public.leases (user_id, active);
create index leases_debtor_idx on public.leases (debtor_id);

create trigger leases_touch
  before update on public.leases
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Which mode the company works in
-- ---------------------------------------------------------------------------
--
-- Not a feature flag: it changes what the product is called on screen. A
-- landlord has tenants and rent, not debtors and receivables, and a navigation
-- item for leases is noise to an agency that has none.

alter table public.users
  add column business_mode text not null default 'general'
    check (business_mode in ('general', 'landlord'));

comment on column public.users.business_mode is
  'general | landlord. Chooses the vocabulary and whether the leases screen is offered.';

grant update (business_mode) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- RLS, on the organization pattern the rest of the schema now uses
-- ---------------------------------------------------------------------------

alter table public.leases enable row level security;

create policy leases_select_active on public.leases
  for select to authenticated
  using (user_id = (select public.current_org_id()));

create policy leases_insert_active on public.leases
  for insert to authenticated
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy leases_update_active on public.leases
  for update to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()))
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy leases_delete_active on public.leases
  for delete to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

grant select, insert, update, delete on public.leases to authenticated;

-- ---------------------------------------------------------------------------
-- A generated charge is an ordinary invoice, and says where it came from
-- ---------------------------------------------------------------------------
--
-- Named rather than folded into 'manual' so that a landlord looking at a
-- disputed month can tell a charge the product created from one somebody typed,
-- and so that deleting a lease can find its charges without guessing.

alter table public.invoices
  drop constraint invoices_source_check;

alter table public.invoices
  add constraint invoices_source_check
  check (source in ('mydata', 'manual', 'elorus', 'import', 'lease'));
