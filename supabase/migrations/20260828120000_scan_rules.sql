-- lefta.app — what the reader has been taught, and who agreed to it
--
-- Corrections are evidence; this is what is done with them. A correction that
-- repeats becomes a *proposal*, a proposal becomes a rule only when a person
-- approves it, and only approved rules reach the reader. Nothing the operator
-- types changes how documents are read until somebody has looked at it and
-- said yes.
--
-- That sequence is the whole design. A reader that rewrites its own rules from
-- user edits is one nobody can predict, test or explain — and this one decides
-- who gets asked for money. Approval is what keeps it explainable: every rule
-- in force was seen, understood and accepted, and can be withdrawn the same way.
--
-- Built to outlive its first use. `kind` and `payload` mean a new sort of rule
-- needs no migration, `status` carries the review, and nothing is ever mutated
-- in place — a decision is recorded beside the rule rather than replacing it,
-- so the history of what the reader believed, and why, stays readable.

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'scan_rule_status' and n.nspname = 'public'
  ) then
    create type public.scan_rule_status as enum ('proposed', 'approved', 'rejected', 'withdrawn');
  end if;
end $$;

create table if not exists public.scan_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,

  -- Which documents this is about. The layout signature, not the supplier: a
  -- rule is true about a template, which is the unit a reading rule can be true
  -- about at all.
  signature     text not null,
  /** The signature in words, so the approval screen can say what it covers. */
  signature_parts text[] not null default '{}',

  -- What sort of rule. Open on purpose: today an example shown to the model,
  -- tomorrow a column hint for the parser, without touching this table.
  kind          text not null,
  payload       jsonb not null,

  status        public.scan_rule_status not null default 'proposed',

  -- Why it was proposed: how many times the same correction was seen, and the
  -- documents it was seen on. A proposal with no evidence behind it is a guess
  -- somebody is being asked to rubber-stamp.
  seen_count    int not null default 1 check (seen_count > 0),
  evidence      jsonb not null default '[]'::jsonb,

  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users (id) on delete set null,

  updated_at    timestamptz not null default now()
);

-- One live proposal per template per kind per field. A second identical
-- correction raises the count on the existing row rather than adding a row
-- nobody can tell from the first.
create unique index if not exists scan_rules_open_uniq
  on public.scan_rules (user_id, signature, kind, (payload ->> 'field'))
  where status = 'proposed';

-- What the reader loads: the approved rules for one tenant, by signature.
create index if not exists scan_rules_approved_idx
  on public.scan_rules (user_id, signature)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Readable by the company it belongs to. Written through server actions that
-- re-check membership, like every other table here.

alter table public.scan_rules enable row level security;

drop policy if exists scan_rules_select on public.scan_rules;
create policy scan_rules_select on public.scan_rules
  for select using (user_id = public.current_org_id());

revoke all on public.scan_rules from anon;
grant select on public.scan_rules to authenticated;
