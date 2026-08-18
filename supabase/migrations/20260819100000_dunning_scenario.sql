-- lefta.app — a configurable scenario, within bounds that stay enforced here
--
-- The ladder was hard-coded, and the reason was never laziness: a predictable,
-- bounded cadence is what keeps this a software provider rather than a
-- collections operation. Making it configurable does not change that, so the
-- limits move from a constant in TypeScript into constraints in the database,
-- where the application cannot talk its way past them.
--
-- What a tenant gains: when each step fires, which channels it uses, whether it
-- fires at all, and an optional repeat of the last step.
--
-- What stays fixed, and why:
--   * still exactly three steps. `dunning_step` is an enum that
--     `dunning_contacts` and `message_templates` both key on, and the
--     "each step fires once per invoice" guarantee is a unique index over it.
--     Arbitrary steps would dissolve all three.
--   * one contact per debtor per calendar day — untouched, still a unique index.
--   * chasing still stops for good at 120 days overdue.

-- ---------------------------------------------------------------------------
-- per-step configuration
-- ---------------------------------------------------------------------------

create table public.dunning_steps (
  user_id     uuid not null references public.users (id) on delete cascade,
  step        dunning_step not null,

  enabled     boolean not null default true,

  -- Days relative to the due date; negative is before it. Bounded so a scenario
  -- cannot be tightened into daily pestering, and so "before the due date"
  -- cannot silently become "after".
  offset_days int not null check (offset_days between -30 and 120),

  -- Which channels this step uses. Empty is not allowed: a step that reaches
  -- nobody should be switched off, not left looking active.
  channels    comm_channel[] not null default '{email}'
                check (cardinality(channels) between 1 and 2),

  updated_at  timestamptz not null default now(),

  primary key (user_id, step)
);

-- `pre_due` fires before the due date by definition. Letting it drift past
-- would leave two steps racing for the same days with no defined order.
alter table public.dunning_steps add constraint dunning_steps_pre_due_is_before
  check (step <> 'pre_due' or offset_days < 0);

-- ---------------------------------------------------------------------------
-- repeating the final step
-- ---------------------------------------------------------------------------

create table public.dunning_settings (
  user_id           uuid primary key references public.users (id) on delete cascade,

  repeat_enabled    boolean not null default false,

  -- A week is the floor on purpose. Anything shorter reads as pressure rather
  -- than a reminder, and the daily contact guarantee alone would not prevent it.
  repeat_every_days int not null default 14 check (repeat_every_days between 7 and 90),

  -- And it ends. An unbounded loop is exactly what the fixed ladder existed to
  -- rule out.
  repeat_max        int not null default 3 check (repeat_max between 1 and 6),

  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- letting a step fire more than once
-- ---------------------------------------------------------------------------
-- The guarantee was "a given step fires at most once per invoice", enforced by a
-- unique index. A repeat has to fire the same step again, so the guarantee gains
-- a dimension rather than losing its teeth: at most once per invoice per cycle.
-- Cycle 0 is the original pass; every repeat increments it.

alter table public.dunning_contacts add column cycle int not null default 0
  check (cycle >= 0);

drop index if exists dunning_contacts_invoice_step_uniq;
create unique index dunning_contacts_invoice_step_uniq
  on public.dunning_contacts (invoice_id, step, cycle)
  where step is not null;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Readable by the tenant; written through server actions that re-check
-- ownership, in line with every other settings table here.

alter table public.dunning_steps enable row level security;
alter table public.dunning_settings enable row level security;

create policy dunning_steps_select_own on public.dunning_steps
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy dunning_settings_select_own on public.dunning_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.dunning_steps from anon, authenticated;
revoke insert, update, delete on public.dunning_settings from anon, authenticated;
revoke all on public.dunning_steps from anon;
revoke all on public.dunning_settings from anon;
