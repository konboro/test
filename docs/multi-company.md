# Many companies, many people

The accountant channel needs one login to reach 200 clients. Until now lefta had
exactly one company per login and no way to give a colleague access to it: the
tenant *was* the auth user. This is how that changed.

## The shape of it

Three facts, and everything else follows:

1. **A company is a `public.users` row.** It always was — that row holds the
   company name, the VAT number, the myDATA credentials, the payment keys, the
   SMS balance. What changed is that its `id` is no longer required to be an
   auth user id.
2. **`organization_members` says who may act for a company**, and in what role.
3. **Which company you are acting for right now is a cookie**, and the database
   is what enforces that you are allowed to.

### Why the table is still called `users`

It is the wrong name — it holds companies, not people — and renaming it is a
mechanical change that touches 28 migrations and 35 source files. Doing it in
the same commit as a security-model change would make the diff unreviewable,
and the rename has to be coordinated with the other sessions working in this
repo. It is a follow-up, tracked at the end of this document. Everywhere in
new code the thing is called an organization, and `user_id` on a business table
means "the organization this row belongs to".

## Scoping: the header, not the query

The old model scoped every table with `user_id = auth.uid()`. Nothing in the
application had to filter by tenant, because the database already did — pages
run `select * from invoices` and get exactly their own.

Membership breaks that: an accountant is a member of 200 companies, so
"everything I may see" is no longer "the company I am looking at". The obvious
fix — add `.eq('user_id', org)` to every query — puts the isolation back into
application code, in 139 places, where one forgotten filter silently mixes two
clients' receivables on the same screen.

So the active company travels as a request header instead, and the policy reads
it:

```sql
create function public.current_org_id() returns uuid
  security definer stable as $$
  select m.organization_id
    from public.organization_members m
   where m.member_id = auth.uid()
     and m.organization_id = coalesce(
           nullif(current_setting('request.headers', true)::json->>'x-lefta-org','')::uuid,
           auth.uid())
   limit 1
$$;
```

Every policy became `user_id = (select public.current_org_id())`. Three
properties matter:

* **The header alone grants nothing.** It only selects among the caller's own
  memberships — the function joins through `organization_members`. Someone
  calling the REST API directly with their own token and a forged header gets
  the same answer as with no header at all: null, and no rows.
* **Application queries did not change.** The pattern the codebase already used
  keeps working, now scoped to the active company.
* **It fails closed.** A missing or stale cookie yields no rows, not another
  company's rows. An `insert` with the wrong `user_id` is rejected by the
  policy, not silently written.

The fallback to `auth.uid()` is what makes the migration a no-op for everyone
who exists today: their company id equals their auth id, so with no cookie at
all they see exactly what they saw before.

`service_role` bypasses RLS entirely, as it always did. The cron sweep iterates
companies and is unaffected — a company is still one `users` row.

## Roles

| role     | reads | writes | members and billing |
|----------|-------|--------|---------------------|
| `owner`  | ✓     | ✓      | ✓                   |
| `member` | ✓     | ✓      | —                   |
| `viewer` | ✓     | —      | —                   |

`viewer` exists for the client the accountant works for: they get a login that
shows their own receivables and cannot send anything, change a template, or
touch a credential. Writes are refused in the policy, not in the UI —
`current_org_role() <> 'viewer'` is an extra predicate on every insert, update
and delete.

## Invitations

An owner invites an email address. The invite is a single-use token, valid for
seven days, and accepting it requires being signed in **as that email address**.

Requiring the address to match is deliberate: a forwarded link should not hand
a stranger a company's receivables ledger, and an accountant who mistypes an
address can revoke and re-send. Acceptance runs as a security-definer function,
because the invitee is by definition not yet a member and cannot see the invite
row through RLS.

## What the app does

* `createClient()` reads the `lefta_org` cookie and sends it as `x-lefta-org`.
  That is the whole integration — one place, and every existing query inherits
  it.
* The middleware sets the cookie on the first request of a session, to the
  caller's first membership, so a fresh login lands somewhere valid.
* The app layout resolves the active company and repairs the cookie when it
  points at a membership that no longer exists (revoked, or company deleted).
* Switching is a server action: verify membership, set the cookie, redirect.
* Server code takes the company from `requireOrganization()`, never from
  `user.id`. The auth user is who you are; the organization is who you are
  acting for, and after this change those are different things.

## Screens

| path                | what                                                       |
|---------------------|------------------------------------------------------------|
| header switcher     | recent companies, search, add, manage                       |
| `/companies`        | the portfolio: every company, what is open, what is overdue |
| `/companies/new`    | add a company                                               |
| `/settings/members` | members and pending invites, owner only                     |
| `/join/[token]`     | accept an invitation                                        |

The portfolio page is the one that makes 200 clients workable: it answers "who
needs me today" across every company at once, from a single aggregate, without
switching into each one to find out. It reads through
`my_organizations_summary()` — security definer, one query, scoped to the
caller's memberships.

## Deliberately not in this change

* **Renaming `users` to `organizations`.** Mechanical, wide, and better on its
  own. Everything else here is written so the rename is a search-and-replace
  plus a compatibility view, not a redesign.
* **Per-member audit.** `communications_log` records the company, not which
  member pressed send. The column belongs there, and the accountant channel
  will want it, but it is a separate migration and a separate UI.
* **Billing per accountant.** SMS credits and payment credentials stay per
  company, which is right — the client's money settles to the client's account.
  A single invoice to the accountant for 200 companies is a pricing decision,
  not a schema one.
