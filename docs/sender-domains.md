# Sending from the tenant's own domain

A plan, not an implementation. Written against the code as it stands on
2026-08-20.

## Where we are now

Every reminder leaves from one address for every tenant: `EMAIL_FROM`, a single
environment variable, defaulting to `lefta.app <noreply@lefta.app>`. What varies
per tenant is the **display name** — `fromHeader()` in `src/lib/email/send.ts`
puts the creditor's name in front of the platform address, so the recipient
reads "Penny IKE" while the address underneath stays ours.

Reply-To is already per tenant (`users.reply_to_email`), and since the fix in
`src/lib/email/reply-to.ts` it falls back to the account address rather than
being omitted.

This is a deliberate design, not an oversight. The platform domain is the one
with SPF and DKIM published, and signing as each creditor's own domain means
verifying each of those domains. What follows is what that would take.

## What changes, and what does not

Changes: the address in the `From` header, for tenants who complete
verification.

Unchanged: Reply-To (already theirs), the display name (already theirs), and
everything about tenants who never set a domain up. The platform address stays
both the default and the fallback.

## Blocker to clear first

The Resend key in production is send-only. Confirmed, not assumed:

    GET https://api.resend.com/domains
    401 restricted_api_key — "This API key is restricted to only send emails"

Domain creation and verification need a full-access key. That key can also
delete domains, so it should be a second key held separately — say
`RESEND_ADMIN_API_KEY` — used only by the settings routes. The sending path
keeps the restricted key it already has. Two keys, two blast radii.

Resend also caps how many domains an account may hold, by plan. Worth checking
against the current plan before offering this to more than a handful of tenants.

## Schema

A table rather than columns on `users`: the DNS records come back as a list,
their state changes over time, and a tenant may eventually want more than one.

    create table public.sender_domains (
      id              uuid primary key default gen_random_uuid(),
      user_id         uuid not null references public.users(id) on delete cascade,
      domain          text not null,
      provider_id     text not null,
      status          text not null default 'pending'
                      check (status in ('pending', 'verified', 'failed')),
      records         jsonb not null default '[]'::jsonb,
      verified_at     timestamptz,
      last_checked_at timestamptz,
      created_at      timestamptz not null default now(),
      unique (user_id, domain)
    );

Notes on the shape:

- `domain` stored lowercase, unique per tenant rather than globally. Two tenants
  could legitimately verify a domain they share, and deciding that for them is
  not our business.
- `status` — `verified` is the only state that may be sent from. `failed` is a
  domain whose DNS stopped resolving.
- `records` holds what Resend returned, verbatim, so the settings page can show
  it without a round trip and a provider outage does not leave the tenant
  staring at a blank screen.

RLS readable by the owning tenant, written only by the server, and
`revoke all ... from anon` like every other table — the schema defaults hand out
grants the policies then have to fight, and the second lock is cheap.

Claim the migration number by creating the file when the work starts. Do not
reserve one now; the other session will fill it.

## The provider calls

Three, against `https://api.resend.com`:

- `POST /domains` with the name — returns the id and the records to publish.
- `GET /domains/:id` — current status. This is the polling call.
- `DELETE /domains/:id` — when the tenant removes it.

The records are the usual three: a TXT for SPF, a TXT for DKIM, and an MX for
the return path. Show them verbatim rather than reformatting — someone copying
into a DNS panel wants the exact strings, and a helpful transformation is how a
trailing dot goes missing.

## Settings flow

1. **Add domain.** One field. Validate the shape, lowercase it, and reject the
   obvious public ones — gmail.com, yahoo.com, outlook.com and friends.
   Verification would fail anyway, but failing at once with a clear reason beats
   a tenant waiting on DNS they can never publish.
2. **Show the records.** A table with copy buttons and a plain sentence saying
   this has to be done wherever their DNS lives.
3. **Check.** A button that calls `GET /domains/:id` and stores the result.
   Manual rather than automatic to begin with: propagation is measured in hours,
   and polling on behalf of a tenant who has not touched their DNS is waste.
4. **Status.** A badge — pending, verified, failed — and when verified, a plain
   statement of which address reminders now come from.
5. **Remove.** Delete at the provider and locally, and fall straight back to the
   platform address.

## Sending

`fromHeader()` takes its address from the environment today. It would take it
from the tenant instead, resolved by one function sitting beside `replyToFor()`:

    fromAddressFor(tenant, domain) -> string

Rules, in order:

- A domain in `verified` state gives `noreply@<domain>`, or a local part the
  tenant chose.
- Anything else — pending, failed, absent — gives the platform address.

Strictly anything else. The failure that matters here is sending from an
unverified domain: it does not bounce, it goes to spam, and the tenant concludes
the product is broken. A domain that was verified and later failed has to fall
back on its own, which is why status is re-checked and stored rather than
assumed once.

## Failure modes worth designing for

- **DNS removed later.** Resend flips the domain to failed. Nothing tells us
  unless we ask, so once a domain is verified the check has to run periodically
  — the one place a cron here earns its keep, and the cron route already exists.
  Falling back silently is correct; so is telling the tenant.
- **Verification never completes.** Common, and usually the records went into
  the wrong zone. Keep showing them rather than hiding them behind a step marked
  done.
- **A tenant claims a domain they do not own.** DNS is the proof, so this is
  handled by construction — but only while we refuse to send from a domain we
  have not seen verified ourselves.
- **Reputation.** A freshly verified domain has none. Moving a tenant off the
  shared address moves their deliverability onto their own reputation: better in
  the long run, worse on day one. Worth a sentence on the page rather than a
  surprise.

## Effort

- Migration plus the provider client and its tests: half a day.
- Settings UI, the three actions, the records table: half a day.
- Sending path and its fallback rules, with tests: a couple of hours.
- The periodic re-check: an hour, on the cron route that already exists.

Two days, with the tests written properly.

## Needed before starting

- A full-access Resend API key, held separately from the sending key.
- How many domains the current Resend plan allows, and therefore whether this is
  offered to every tenant or to some.
- Fixed `noreply@` local part, or tenant-chosen. Fixed is one fewer thing to
  validate and one fewer thing to get wrong.
