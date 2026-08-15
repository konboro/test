-- lefta.app — initial schema
-- B2B accounts-receivable automation for Greek SMEs.
-- lefta operates strictly as an IT/software provider: it transmits reminders on
-- behalf of the creditor. It never acts as a debt collection agency.

-- pgcrypto ships pre-installed into the `extensions` schema on a real Supabase
-- project, which makes a bare `create extension if not exists pgcrypto` a silent
-- no-op: the extension is already there, so nothing moves into `public` and
-- gen_random_bytes stays outside the search_path used while applying DDL. Pin
-- the schema and qualify the call sites, so this applies identically on Supabase
-- and on the plain Postgres that supabase/tests/run.sh spins up.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type invoice_status as enum ('pending', 'paid', 'cancelled', 'written_off');
create type comm_channel   as enum ('email', 'sms');
create type comm_status    as enum ('sent', 'failed', 'skipped');

-- Dunning steps are a hard-coded, fixed ladder. Not user configurable by design:
-- a predictable cadence is what keeps the service on the IT-provider side of the
-- line, and it makes the audit trail defensible.
create type dunning_step as enum ('pre_due', 'overdue_2', 'overdue_10');

-- ---------------------------------------------------------------------------
-- users (tenants)
-- ---------------------------------------------------------------------------

create table public.users (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  text not null,
  company_name           text,
  vat_number             text,                       -- creditor's own AFM
  phone                  text,

  -- myDATA (AADE) credentials. The subscription key is stored encrypted at rest
  -- (AES-256-GCM, application-held key) and is never exposed to the browser.
  mydata_user_id         text,
  mydata_subscription_key_enc text,
  mydata_environment     text not null default 'production'
                         check (mydata_environment in ('production', 'sandbox')),
  mydata_last_sync_at    timestamptz,

  stripe_customer_id     text unique,

  sms_credits            integer not null default 0 check (sms_credits >= 0),

  -- Master switch for the automation engine.
  automation_enabled     boolean not null default true,
  reply_to_email         text,

  -- myDATA documents carry no due date, only an issue date. The due date is
  -- derived from the tenant's standard payment terms.
  default_payment_terms_days integer not null default 30
                         check (default_payment_terms_days between 0 and 365),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column public.users.mydata_subscription_key_enc is
  'AES-256-GCM ciphertext, format: v1:<iv_b64>:<tag_b64>:<ciphertext_b64>. Never returned to clients.';

-- ---------------------------------------------------------------------------
-- debtors
-- ---------------------------------------------------------------------------

create table public.debtors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  name         text not null,
  vat_number   text,                                  -- debtor AFM
  email        text,
  phone        text,                                  -- E.164, e.g. +3069...
  notes        text,
  -- When true the automation engine skips this debtor entirely (disputes,
  -- payment plans, opt-outs). Auditable escape hatch.
  muted        boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A debtor is identified within a tenant by their AFM when present.
create unique index debtors_user_vat_uniq
  on public.debtors (user_id, vat_number)
  where vat_number is not null;

create index debtors_user_id_idx on public.debtors (user_id);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  debtor_id      uuid not null references public.debtors (id) on delete cascade,

  -- MARK is the unique myDATA document id assigned by AADE. Stored exactly as
  -- received, as text. Null for invoices created manually in the app.
  mark           text,
  invoice_number text,
  series         text,

  -- Money is stored in minor units (cents) to keep arithmetic exact.
  amount_cents   bigint not null check (amount_cents > 0),
  currency       text   not null default 'EUR',

  issue_date     date not null,
  due_date       date not null,
  status         invoice_status not null default 'pending',

  paid_at        timestamptz,
  paid_amount_cents bigint check (paid_amount_cents >= 0),

  -- Stripe Checkout session for the debtor-facing payment link.
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,

  -- Opaque, unguessable token used in the public /pay/<token> URL so that
  -- internal ids are never enumerable by third parties.
  pay_token      text not null default encode(extensions.gen_random_bytes(24), 'hex'),

  source         text not null default 'mydata' check (source in ('mydata', 'manual')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index invoices_user_mark_uniq
  on public.invoices (user_id, mark)
  where mark is not null;

create unique index invoices_pay_token_uniq on public.invoices (pay_token);
create index invoices_user_status_idx on public.invoices (user_id, status);
create index invoices_debtor_idx on public.invoices (debtor_id);
-- Drives the daily dunning sweep.
create index invoices_due_date_idx on public.invoices (due_date) where status = 'pending';

-- ---------------------------------------------------------------------------
-- dunning_contacts — THE COMPLIANCE LOCK
-- ---------------------------------------------------------------------------
-- A "contact" is one reminder event aimed at one debtor. A single contact may
-- fan out to more than one channel (steps 2 and 3 send an email *and* an SMS),
-- but it is still one contact.
--
-- The rule the product guarantees is: a debtor is contacted at most once per
-- calendar day, no matter how many overdue invoices they have. Claiming a row
-- here is how the engine acquires that right, so the guarantee holds under
-- concurrency and cannot be bypassed by a buggy code path.

create table public.dunning_contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  debtor_id   uuid not null references public.debtors (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  step        dunning_step not null,
  contact_on  date not null default ((now() at time zone 'Europe/Athens')::date),
  created_at  timestamptz not null default now()
);

-- One contact per debtor per calendar day. Hard, database-level.
create unique index dunning_contacts_one_per_debtor_per_day
  on public.dunning_contacts (debtor_id, contact_on);

-- A given step fires at most once for a given invoice, so a missed cron run is
-- caught up rather than replayed.
create unique index dunning_contacts_invoice_step_uniq
  on public.dunning_contacts (invoice_id, step);

create index dunning_contacts_user_idx on public.dunning_contacts (user_id, contact_on desc);

-- ---------------------------------------------------------------------------
-- communications_log — append-only audit trail
-- ---------------------------------------------------------------------------

create table public.communications_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  debtor_id    uuid not null references public.debtors (id) on delete cascade,
  invoice_id   uuid references public.invoices (id) on delete set null,
  contact_id   uuid references public.dunning_contacts (id) on delete set null,

  channel      comm_channel not null,
  step         dunning_step,
  status       comm_status  not null default 'sent',

  recipient    text not null,          -- email address or phone actually used
  subject      text,
  content      text not null,          -- exact body transmitted
  provider_message_id text,
  error        text,

  -- Local (Europe/Athens) calendar day of the send.
  sent_on      date not null default ((now() at time zone 'Europe/Athens')::date),
  sent_at      timestamptz not null default now()
);

-- One delivery per channel per contact: belt-and-braces against a retry loop
-- double-sending the same reminder.
create unique index communications_log_contact_channel_uniq
  on public.communications_log (contact_id, channel)
  where contact_id is not null and status = 'sent';

create index communications_log_user_idx    on public.communications_log (user_id, sent_at desc);
create index communications_log_invoice_idx on public.communications_log (invoice_id);
create index communications_log_debtor_idx  on public.communications_log (debtor_id, sent_on desc);

-- The log is an audit trail: rows may be inserted but never changed or removed.
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'communications_log is append-only';
end;
$$;

create trigger communications_log_no_update
  before update or delete on public.communications_log
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- sms_credit_purchases — ledger of credit top-ups
-- ---------------------------------------------------------------------------

create table public.sms_credit_purchases (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  credits           integer not null check (credits > 0),
  amount_cents      bigint  not null check (amount_cents >= 0),
  currency          text    not null default 'EUR',
  stripe_checkout_session_id text not null,
  created_at        timestamptz not null default now()
);

-- Stripe may deliver the same webhook event more than once. This makes credit
-- granting idempotent.
create unique index sms_credit_purchases_session_uniq
  on public.sms_credit_purchases (stripe_checkout_session_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_touch    before update on public.users    for each row execute function public.touch_updated_at();
create trigger debtors_touch  before update on public.debtors  for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- provision a tenant row whenever an auth user signs up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, company_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'company_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
