-- lefta.app — the rules for the step that fires on issue, and for the new rungs
--
-- Separate from the migration that added the enum values because Postgres will
-- not let a value be used in the same transaction that created it.

-- ---------------------------------------------------------------------------
-- on_issue is not measured from the due date
-- ---------------------------------------------------------------------------
-- Every other step means "this many days from the due date". This one means
-- "when the invoice was confirmed", so its offset is meaningless rather than
-- merely unusual. Pinning it to zero stops a stored number implying a schedule
-- the engine will never read.

alter table public.dunning_steps
  add constraint dunning_steps_on_issue_has_no_offset
  check (step <> 'on_issue' or offset_days = 0);

-- ---------------------------------------------------------------------------
-- the ordering guarantee still only applies to the due-date ladder
-- ---------------------------------------------------------------------------
-- `pre_due` fires before the due date by definition, and that check predates
-- this migration. It is restated here only because the original was written
-- when three steps existed and `step <> 'pre_due'` now lets five new values
-- through unexamined — which is correct, and worth saying out loud rather than
-- leaving as an accident of how the check was phrased.

comment on constraint dunning_steps_pre_due_is_before on public.dunning_steps is
  'pre_due sits before the due date. The step_4..step_8 rungs are unconstrained '
  'in sign on purpose: a tenant may want a second reminder before the due date.';

-- ---------------------------------------------------------------------------
-- how a scenario applies to one invoice
-- ---------------------------------------------------------------------------
-- Until now an invoice could only opt out entirely, through
-- `invoices.automation_enabled`. That column stays as the fast switch it is;
-- this adds the middle case — the same ladder with something changed for this
-- one document, without touching the tenant's default.
--
-- Overrides are stored as rows rather than as a jsonb blob so the same check
-- constraints that guard the tenant scenario guard these too. A scenario that
-- can be tightened into daily pestering per invoice would make the bounds on
-- the tenant scenario decorative.

create table if not exists public.invoice_dunning_steps (
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  step        public.dunning_step not null,

  enabled     boolean not null default true,
  offset_days int not null check (offset_days between -30 and 120),
  channels    public.comm_channel[] not null default '{email}'
                check (cardinality(channels) between 1 and 2),

  updated_at  timestamptz not null default now(),

  primary key (invoice_id, step),

  constraint invoice_dunning_steps_pre_due_is_before
    check (step <> 'pre_due' or offset_days < 0),
  constraint invoice_dunning_steps_on_issue_has_no_offset
    check (step <> 'on_issue' or offset_days = 0)
);

-- Which of the three modes an invoice is in. `custom` is the only one that
-- consults the table above; the column exists so that an invoice with no
-- override rows can still be distinguished from one whose overrides happen to
-- match the default.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'invoice_scenario_mode' and n.nspname = 'public'
  ) then
    create type public.invoice_scenario_mode as enum ('default', 'custom', 'off');
  end if;
end $$;

alter table public.invoices
  add column if not exists scenario_mode public.invoice_scenario_mode not null default 'default';

-- The existing switch and the new mode must not disagree. An invoice that was
-- opted out before this migration is opted out after it.
update public.invoices set scenario_mode = 'off'
  where automation_enabled = false and scenario_mode = 'default';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Readable by whoever can read the invoice; written through server actions that
-- re-check ownership, in line with every other table here.

alter table public.invoice_dunning_steps enable row level security;

drop policy if exists invoice_dunning_steps_select on public.invoice_dunning_steps;
create policy invoice_dunning_steps_select on public.invoice_dunning_steps
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_dunning_steps.invoice_id
        and i.user_id = public.current_org_id()
    )
  );

revoke all on public.invoice_dunning_steps from anon;
grant select on public.invoice_dunning_steps to authenticated;
