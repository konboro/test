-- Functional verification of the lefta.app schema against a real Postgres.
-- Every block asserts; any failure aborts the script (ON_ERROR_STOP=1).

\set ON_ERROR_STOP on
\set QUIET on

-- --------------------------------------------------------------------------
-- fixtures: two tenants, created through the auth trigger
-- --------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.gr', '{"company_name":"Alpha AE"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.gr', '{"company_name":"Beta AE"}');

do $$
declare n integer;
begin
  select count(*) into n from public.users;
  if n <> 2 then raise exception 'FAIL: signup trigger did not provision tenants (got %)', n; end if;

  perform 1 from public.users
   where id = '11111111-1111-1111-1111-111111111111' and company_name = 'Alpha AE';
  if not found then raise exception 'FAIL: company_name not carried from user metadata'; end if;
end $$;
\echo '  ok  signup trigger provisions the tenant row'

insert into public.debtors (id, user_id, name, vat_number, email, phone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Pelatis A', '111222333', 'debtor@example.gr', '+306971234567'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Pelatis B', '444555666', 'other@example.gr', null);

insert into public.invoices (id, user_id, debtor_id, mark, invoice_number, amount_cents, issue_date, due_date) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', '400001912345678', '1042', 124000, '2026-07-01', '2026-07-31'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', '400001912345679', '1043',  62000, '2026-07-02', '2026-08-01');

-- --------------------------------------------------------------------------
-- pay_token: auto-generated, unique, unguessable
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  select pay_token into t from public.invoices where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if t is null or length(t) <> 48 then
    raise exception 'FAIL: pay_token should be 48 hex chars, got %', coalesce(length(t)::text, 'null');
  end if;
end $$;
\echo '  ok  pay_token generated as 24 random bytes'

-- --------------------------------------------------------------------------
-- short_code: auto-generated, unique, drawn from the unambiguous alphabet
-- --------------------------------------------------------------------------

do $$
declare c1 text; c2 text;
begin
  select short_code into c1 from public.invoices where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select short_code into c2 from public.invoices where id = 'bbbbbbbb-0000-0000-0000-000000000002';

  if c1 is null or length(c1) <> 10 then
    raise exception 'FAIL: short_code should be 10 chars, got %', coalesce(length(c1)::text, 'null');
  end if;

  -- Lowercase or an ambiguous glyph here would break the root-level route: the
  -- middleware only treats a path as public when it matches this alphabet.
  if c1 !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$' then
    raise exception 'FAIL: short_code outside the allowed alphabet: %', c1;
  end if;

  if c1 = c2 then
    raise exception 'FAIL: short_code repeated across invoices: %', c1;
  end if;
end $$;
\echo '  ok  short_code generated as 10 unambiguous symbols'

-- The public lookup has to answer to either credential, or every reminder sent
-- before short links existed would 404.
do $$
declare tok text; code text; by_token uuid; by_code uuid;
begin
  select pay_token, short_code into tok, code
    from public.invoices where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  select invoice_id into by_token from public.get_invoice_for_payment(tok);
  select invoice_id into by_code  from public.get_invoice_for_payment(code);

  if by_token is distinct from by_code or by_code is null then
    raise exception 'FAIL: lookup disagrees between credentials (% vs %)', by_token, by_code;
  end if;
end $$;
\echo '  ok  get_invoice_for_payment accepts both the short code and the legacy token'

-- --------------------------------------------------------------------------
-- COMPLIANCE LOCK: one contact per debtor per calendar day
-- --------------------------------------------------------------------------

insert into public.dunning_contacts (user_id, debtor_id, invoice_id, step, contact_on)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001', 'overdue_2', '2026-08-15');

do $$
begin
  -- Same debtor, same day, a DIFFERENT invoice and step: must still be refused.
  begin
    insert into public.dunning_contacts (user_id, debtor_id, invoice_id, step, contact_on)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000002', 'pre_due', '2026-08-15');
    raise exception 'FAIL: daily contact limit was not enforced';
  exception when unique_violation then
    null;
  end;
end $$;
\echo '  ok  second contact to the same debtor on the same day is refused'

do $$
begin
  -- The same debtor on a LATER day is fine.
  insert into public.dunning_contacts (user_id, debtor_id, invoice_id, step, contact_on)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002', 'pre_due', '2026-08-16');
end $$;
\echo '  ok  the same debtor can be contacted again the next day'

do $$
begin
  -- Same invoice + same step on a later day: refused, so a step never repeats.
  begin
    insert into public.dunning_contacts (user_id, debtor_id, invoice_id, step, contact_on)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001', 'overdue_2', '2026-09-01');
    raise exception 'FAIL: a step was allowed to fire twice for one invoice';
  exception when unique_violation then
    null;
  end;
end $$;
\echo '  ok  a given step fires at most once per invoice'

-- --------------------------------------------------------------------------
-- communications_log is append-only
-- --------------------------------------------------------------------------

insert into public.communications_log
  (id, user_id, debtor_id, invoice_id, channel, step, recipient, subject, content)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'email', 'overdue_2', 'debtor@example.gr', 'Subject', 'Body');

do $$
begin
  begin
    update public.communications_log set content = 'tampered'
     where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL: audit log accepted an UPDATE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  begin
    delete from public.communications_log where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL: audit log accepted a DELETE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;
\echo '  ok  communications_log rejects UPDATE and DELETE, even as superuser'

-- --------------------------------------------------------------------------
-- SMS credit accounting
-- --------------------------------------------------------------------------

do $$
declare ok boolean; bal integer;
begin
  update public.users set sms_credits = 2 where id = '11111111-1111-1111-1111-111111111111';

  select public.consume_sms_credit('11111111-1111-1111-1111-111111111111') into ok;
  if not ok then raise exception 'FAIL: consume_sms_credit refused with credits available'; end if;

  select public.consume_sms_credit('11111111-1111-1111-1111-111111111111') into ok;
  select public.consume_sms_credit('11111111-1111-1111-1111-111111111111') into ok;
  if ok then raise exception 'FAIL: consume_sms_credit went past zero'; end if;

  select sms_credits into bal from public.users where id = '11111111-1111-1111-1111-111111111111';
  if bal <> 0 then raise exception 'FAIL: balance should be 0, got %', bal; end if;
end $$;
\echo '  ok  consume_sms_credit decrements and refuses to go negative'

do $$
declare granted boolean; bal integer;
begin
  select public.grant_sms_credits('11111111-1111-1111-1111-111111111111', 100, 900, 'cs_test_123')
    into granted;
  if not granted then raise exception 'FAIL: first credit grant did not apply'; end if;

  -- Stripe replays the same event: must be a no-op.
  select public.grant_sms_credits('11111111-1111-1111-1111-111111111111', 100, 900, 'cs_test_123')
    into granted;
  if granted then raise exception 'FAIL: replayed webhook granted credits twice'; end if;

  select sms_credits into bal from public.users where id = '11111111-1111-1111-1111-111111111111';
  if bal <> 100 then raise exception 'FAIL: balance should be 100 after replay, got %', bal; end if;
end $$;
\echo '  ok  grant_sms_credits is idempotent against Stripe webhook replays'

-- --------------------------------------------------------------------------
-- public payment lookup
-- --------------------------------------------------------------------------

do $$
declare r record; tok text;
begin
  select pay_token into tok from public.invoices where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select * into r from public.get_invoice_for_payment(tok);

  if r.amount_cents <> 124000 then raise exception 'FAIL: wrong amount %', r.amount_cents; end if;
  if r.debtor_name <> 'Pelatis A' then raise exception 'FAIL: wrong debtor %', r.debtor_name; end if;
  if r.creditor_name <> 'Alpha AE' then raise exception 'FAIL: wrong creditor %', r.creditor_name; end if;

  -- An unknown token must reveal nothing.
  perform * from public.get_invoice_for_payment('does-not-exist');
  if found then raise exception 'FAIL: unknown pay token returned a row'; end if;
end $$;
\echo '  ok  get_invoice_for_payment resolves a token and leaks nothing otherwise'

-- --------------------------------------------------------------------------
-- RLS: tenant isolation
-- --------------------------------------------------------------------------

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.debtors;
  if n <> 1 then raise exception 'FAIL: tenant A sees % debtors, expected only its own 1', n; end if;

  select count(*) into n from public.invoices;
  if n <> 2 then raise exception 'FAIL: tenant A sees % invoices, expected 2', n; end if;

  select count(*) into n from public.users;
  if n <> 1 then raise exception 'FAIL: tenant A sees % tenant rows, expected 1', n; end if;
end $$;
\echo '  ok  RLS confines a tenant to its own debtors, invoices and profile'

do $$
begin
  -- Writing a row that belongs to the other tenant must be refused.
  begin
    insert into public.debtors (user_id, name)
    values ('22222222-2222-2222-2222-222222222222', 'Injected');
    raise exception 'FAIL: cross-tenant insert was allowed';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  cross-tenant insert is refused by the RLS check'

-- --------------------------------------------------------------------------
-- column grants: the myDATA key and settlement fields are unreachable
-- --------------------------------------------------------------------------

do $$
begin
  begin
    perform mydata_subscription_key_enc from public.users;
    raise exception 'FAIL: authenticated could read the encrypted myDATA key';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  authenticated cannot read mydata_subscription_key_enc at all'

do $$
begin
  begin
    update public.users set sms_credits = 999999
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: authenticated granted itself SMS credits';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.invoices set pay_token = 'forged'
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'FAIL: authenticated forged a pay_token';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.invoices set status = 'paid', paid_at = now()
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'FAIL: authenticated wrote settlement columns directly';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  sms_credits, pay_token and settlement columns are not writable by a session'

do $$
begin
  -- The tenant may still edit its own profile fields.
  update public.users set company_name = 'Alpha AE renamed'
   where id = '11111111-1111-1111-1111-111111111111';
end $$;
\echo '  ok  a tenant can still edit its own profile fields'

do $$
begin
  begin
    insert into public.communications_log (user_id, debtor_id, channel, recipient, content)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
            'email', 'x@y.gr', 'forged audit entry');
    raise exception 'FAIL: a session wrote to the audit log';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  a session cannot write its own audit-log entries'

reset role;

-- --------------------------------------------------------------------------
-- anonymous debtor: can pay, can see nothing else
-- --------------------------------------------------------------------------

set role anon;

do $$
declare n integer;
begin
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FAIL: anon read % invoices', n; end if;

  select count(*) into n from public.debtors;
  if n <> 0 then raise exception 'FAIL: anon read % debtors', n; end if;
end $$;
\echo '  ok  anon reads no invoices and no debtors directly'

reset role;

-- --------------------------------------------------------------------------
-- funnel events: tenant-readable, server-written, invisible to anon
-- --------------------------------------------------------------------------

insert into public.funnel_events (user_id, invoice_id, debtor_id, channel, event)
values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'email', 'page_view');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.funnel_events;
  if n <> 1 then raise exception 'FAIL: tenant A sees % funnel events, expected 1', n; end if;

  begin
    insert into public.funnel_events (user_id, invoice_id, event)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            'page_view');
    raise exception 'FAIL: a session wrote its own funnel event';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  funnel events are readable by their tenant and writable only by the server'

reset role;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.funnel_events;
  if n <> 0 then raise exception 'FAIL: tenant B sees % of tenant A''s funnel events', n; end if;
end $$;
\echo '  ok  funnel events do not cross tenants'

reset role;

set role anon;

do $$
begin
  -- Stronger than zero rows: anon holds no SELECT grant on this table at all.
  begin
    perform count(*) from public.funnel_events;
    raise exception 'FAIL: anon could select from funnel_events';
  exception when insufficient_privilege then
    null;
  end;
end $$;
\echo '  ok  anon cannot read funnel events at all'

reset role;
\echo ''
\echo 'ALL SCHEMA CHECKS PASSED'
