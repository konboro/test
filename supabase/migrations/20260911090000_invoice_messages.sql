-- lefta.app — one invoice's own wording
--
-- The notice on issue goes out the moment an invoice is raised, and raising it
-- is exactly when the operator knows this customer needs different words — a
-- bank account named in the body, a person addressed directly, an agreed
-- reference. Until now the only lever was the account template, which changes
-- the wording for everyone.
--
-- A row here overrides the account template for one invoice, one step, one
-- channel. No row means the account wording (and its future edits) applies —
-- the same collapse-to-default contract the per-invoice cadence uses, held by
-- the application: text identical to the account template is never stored.
--
-- The shape covers every step; today the application only writes `on_issue`.

create table public.invoice_messages (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  step       dunning_step not null,
  channel    comm_channel not null,

  -- Null for SMS, which has no subject line. Enforced, because a subject on an
  -- SMS row would imply a rendering path that does not exist.
  subject    text,
  body       text not null check (length(body) between 1 and 4000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (invoice_id, step, channel),
  constraint invoice_messages_sms_no_subject
    check (channel <> 'sms' or subject is null),
  constraint invoice_messages_subject_length
    check (subject is null or length(subject) <= 300)
);

comment on table public.invoice_messages is
  'Per-invoice wording overrides for outgoing messages. A row wins over the account template for that invoice/step/channel; no row means the account wording applies. Text identical to the account template is not stored — see docs and lib/dunning/invoice-messages.';

create index invoice_messages_user_idx on public.invoice_messages (user_id);

create trigger invoice_messages_touch
  before update on public.invoice_messages
  for each row execute function public.touch_updated_at();

-- Reads: the company being acted for. Writes: the server only, after the same
-- ownership checks every other invoice mutation makes — what a customer is
-- about to be told is not editable by a browser session directly.
alter table public.invoice_messages enable row level security;

create policy invoice_messages_select_active on public.invoice_messages
  for select to authenticated
  using (user_id = (select public.current_org_id()));

revoke all on public.invoice_messages from anon, authenticated;
grant select on public.invoice_messages to authenticated;
