-- The application and the database disagreed about which company is active.
--
-- With no `x-lefta-org` header the app fell back to the caller's *oldest*
-- membership (src/lib/orgs/pick.ts), while this function fell back to
-- `auth.uid()` — the company whose id happens to equal the person's auth id.
-- For anyone whose own company is not also their oldest membership, those are
-- two different companies.
--
-- The consequence was total rather than subtle. Settings asks for the profile of
-- the company the app resolved; the policy shows the company the database
-- resolved; the query returns nothing; and the handler for "no profile" is
-- redirect('/login'). A signed-in operator was thrown out of a working session,
-- which reads as the whole product breaking.
--
-- Removing the `auth.uid()` substitute makes the first branch yield NULL when no
-- header arrives, so both sides fall through to the same oldest-membership rule.
-- It is a no-op for anyone with a single company, whose only membership is both
-- their own and their oldest.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select m.organization_id
       from public.organization_members m
      where m.member_id = (select auth.uid())
        and m.organization_id = public.requested_org_id()),
    (select m.organization_id
       from public.organization_members m
      where m.member_id = (select auth.uid())
      order by m.created_at, m.organization_id
      limit 1)
  )
$function$;
