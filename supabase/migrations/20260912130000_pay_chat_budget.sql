-- A ceiling on what an anonymous visitor can spend on the model.
--
-- The payment page lets whoever holds the link say "I already paid" or "this
-- document is wrong", and a model reads the conversation. The endpoint is
-- public by the same argument as the payment itself: the credential in the link
-- is everything the caller holds, and it buys exactly two abilities.
--
-- What it did not buy was a budget. The request schema caps the turns inside one
-- call, but nothing capped the calls: a visitor holding one valid link — or
-- anyone the reminder was forwarded to — could repeat the request indefinitely,
-- each repetition a model call billed to us. The only brake was the report
-- itself: once filed, the endpoint answers "already on file" and stops. Before
-- that, there was none.
--
-- Counted per invoice per day, because the credential resolves to exactly one
-- invoice, so that is the same thing as per caller — without storing anything
-- about the caller. A real exchange is a handful of turns.

create table if not exists public.pay_chat_turns (
  invoice_id uuid primary key references public.invoices (id) on delete cascade,
  day        date not null,
  turns      int  not null default 0
);

comment on table public.pay_chat_turns is
  'Model turns spent on the public payment-page chat, per invoice per day. Reset by the day changing, not by a job.';

-- No policies and no grants: the table is written only by the route handler,
-- which runs with the service role. RLS on with nothing granted means a browser
-- session cannot read or write it at all, which is the right answer for a
-- counter whose whole job is to be unforgeable.
alter table public.pay_chat_turns enable row level security;

/**
 * Spends one turn, and says whether there was one to spend.
 *
 * The check and the increment are one statement on purpose. Done as a read then
 * a write, two requests arriving together would both read the old count and both
 * be allowed — which is precisely the shape of traffic a budget exists to stop.
 *
 * A new day is a fresh allowance: the row is reused rather than deleted, so the
 * table stays one row per invoice that ever opened the panel.
 */
create or replace function public.claim_pay_chat_turn(
  p_invoice uuid,
  p_limit   int,
  p_day     date
) returns boolean
language plpgsql
as $$
declare
  spent int;
begin
  insert into public.pay_chat_turns (invoice_id, day, turns)
       values (p_invoice, p_day, 1)
  on conflict (invoice_id) do update
          set turns = case when public.pay_chat_turns.day = p_day
                           then public.pay_chat_turns.turns + 1
                           else 1
                      end,
              day   = p_day
    returning turns into spent;

  return spent <= p_limit;
end;
$$;

revoke all on function public.claim_pay_chat_turn(uuid, int, date) from public;
revoke all on function public.claim_pay_chat_turn(uuid, int, date) from anon;
revoke all on function public.claim_pay_chat_turn(uuid, int, date) from authenticated;
grant execute on function public.claim_pay_chat_turn(uuid, int, date) to service_role;
