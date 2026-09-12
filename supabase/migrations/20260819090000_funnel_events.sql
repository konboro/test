-- lefta.app — first-party funnel events
--
-- The middle of the dunning funnel: a reminder was sent (communications_log),
-- an invoice got paid (invoices) — but whether anyone *opened the link* or
-- *started a payment* was invisible. These two events are measured on our own
-- pages, so no third-party tracker ever touches a debtor.
--
-- Design (docs/funnel-analytics.md): rows are deliberately minimal. No IP, no
-- user agent, no referrer, no cookie ids — a row says "this invoice's link was
-- used, from this channel, at this time" and nothing else. Debtors are data
-- subjects who never signed up to this platform; explaining a funnel is not a
-- reason to profile them.

create table public.funnel_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  debtor_id   uuid references public.debtors(id) on delete set null,

  -- Which message carried the visitor here, read from the ?c= tag the dispatch
  -- appends per channel. 'other' is a typed, forwarded or untagged visit.
  channel     text check (channel in ('email', 'sms', 'other')),

  -- 'page_view' fires from a client-side beacon after hydration (prefetchers
  -- fetch pages but rarely execute them); 'checkout_started' fires server-side
  -- when a payment session is actually created. 'paid' is deliberately NOT an
  -- event here — settlement already lives on the invoice and duplicating it
  -- would create a second source of truth.
  event       text not null check (event in ('page_view', 'checkout_started')),

  occurred_at timestamptz not null default now()
);

create index funnel_events_user_idx    on public.funnel_events (user_id, occurred_at desc);
create index funnel_events_invoice_idx on public.funnel_events (invoice_id, event, occurred_at desc);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Readable by the owning tenant; written only by the two server paths (the
-- beacon endpoint and the pay-start route) under the service role. The debtor
-- holding the pay link is anonymous, and anon reads nothing here.

alter table public.funnel_events enable row level security;

create policy funnel_events_select_own on public.funnel_events
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.funnel_events from anon, authenticated;
revoke all on public.funnel_events from anon;

-- ---------------------------------------------------------------------------
-- retention
-- ---------------------------------------------------------------------------
-- Events answer "how did the last campaigns perform", not "what happened two
-- years ago". Where pg_cron exists (real Supabase projects) the table trims
-- itself; the plain-Postgres test harness has no pg_cron and skips this.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'funnel-events-retention',
      '30 4 * * *',
      $cron$delete from public.funnel_events where occurred_at < now() - interval '12 months'$cron$
    );
  end if;
end $$;
