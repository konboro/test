-- lefta.app — editable message copy, and manual "remind about payment" sends.
--
-- Two related changes:
--   1. tenants can override the wording of any reminder;
--   2. a reminder can be sent by hand from the invoice list, outside the ladder.

-- ---------------------------------------------------------------------------
-- manual contacts
-- ---------------------------------------------------------------------------
-- A manual reminder is a real contact — it must respect the once-per-debtor-per-
-- day guarantee exactly like an automated one, because that promise is what
-- keeps the product on the right side of the line and it says nothing about who
-- pressed the button.
--
-- What it must *not* do is consume a rung of the ladder. Those are the automated
-- escalation, and a human nudge today should not mean the invoice is never
-- chased at step 2 later.
--
-- So `step` becomes nullable: null means "manual". The daily lock is untouched
-- and still covers both kinds; the once-per-invoice-per-step lock now applies
-- only to ladder steps, leaving manual reminders repeatable (subject to the
-- daily limit).
--
-- Note this deliberately does not add 'manual' to the dunning_step enum:
-- `alter type ... add value` cannot be used in the same transaction that adds
-- it, which would split this migration in two for no gain.

alter table public.dunning_contacts add column manual boolean not null default false;
alter table public.dunning_contacts alter column step drop not null;

alter table public.dunning_contacts add constraint dunning_contacts_step_presence
  check ((manual and step is null) or (not manual and step is not null));

comment on column public.dunning_contacts.manual is
  'True when a person pressed "remind" rather than the ladder firing. step is null for these.';

-- Ladder steps stay one-per-invoice; manual rows are excluded from that lock.
drop index if exists dunning_contacts_invoice_step_uniq;
create unique index dunning_contacts_invoice_step_uniq
  on public.dunning_contacts (invoice_id, step)
  where step is not null;

-- ---------------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------------
-- One row per (tenant, slot). A slot is a ladder step or the manual reminder,
-- times a channel. A missing row means "use the built-in default", so a tenant
-- who never opens the editor keeps working copy and edits stay reversible by
-- deleting the override.
--
-- Bodies are plain text with {{placeholders}}. They are never treated as HTML:
-- the email renderer escapes them and drops them into the platform shell, so a
-- template cannot inject markup into a message sent on someone else's behalf.

create table public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,

  -- null = the manual reminder, mirroring dunning_contacts.step.
  step       dunning_step,
  channel    comm_channel not null,

  -- Email only; ignored for SMS.
  subject    text,
  body       text not null check (length(btrim(body)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per slot. Two partial indexes rather than one over
-- `coalesce(step::text, 'manual')`, because casting an enum to text is not
-- IMMUTABLE — enum labels can be renamed — and Postgres refuses it in an index.
-- Splitting on the null also states the intent more plainly: ladder slots are
-- keyed by step, and there is exactly one manual slot per channel.
create unique index message_templates_user_step_channel_uniq
  on public.message_templates (user_id, step, channel)
  where step is not null;

create unique index message_templates_user_manual_channel_uniq
  on public.message_templates (user_id, channel)
  where step is null;

create index message_templates_user_idx on public.message_templates (user_id);

create trigger message_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

alter table public.message_templates enable row level security;

create policy message_templates_select_own on public.message_templates
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy message_templates_insert_own on public.message_templates
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy message_templates_update_own on public.message_templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy message_templates_delete_own on public.message_templates
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The tenant owns its own copy, but must not be able to reassign a template to
-- another tenant or forge timestamps.
revoke update on public.message_templates from anon, authenticated;
grant update (step, channel, subject, body) on public.message_templates to authenticated;
