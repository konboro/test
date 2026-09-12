# CLAUDE.md — how work ships in this repo

Read `docs/handover.md` first: where credentials live, the traps this codebase
has already sprung, and why no secret is ever written down here.

## Repo facts

- This is **lefta.app** — accounts-receivable automation for Greek SMEs
  (Next.js + Supabase + Stripe/Viva/Revolut + Elorus/myDATA).
- Production is https://lefta.app — Vercel project `lefta`, scope
  `konrads-projects-7e53c7e8`, deployed **via Vercel CLI from
  `fix/supabase-deploy`**. There is no git-triggered deploy.
- The default branch (`claude/lefta-app-mvp-build-9niyrx`) is a stale MVP.
  Never base work on it, never merge into it.
- Supabase project `lefta-prod`, ref `mikngfoizxazndsrwlgl`. Migrations live in
  `supabase/migrations/` and are applied by hand (Management API /
  `supabase db push`) — **deploying does not apply them**.

## Rules for working agents

The operator has designated a single **integrator agent** that watches this
repo. Everyone else is a working agent, and for working agents the rules are:

1. **Branch off a freshly fetched `fix/supabase-deploy`.** Name the branch
   `feat/…`, `fix/…` or `docs/…`.
2. When done, **open a PR against `fix/supabase-deploy`**. The PR body states:
   what changed and why, how it was verified (`npm run typecheck`, `npm test`,
   `next build`), and — explicitly, under a **"Przed deployem"** heading —
   whether it adds migrations or needs new env vars.
3. **Do not push to `fix/supabase-deploy` directly. Do not run
   `vercel deploy` / `vercel --prod`. Do not merge a PR — not even your own.**
   The integrator reviews every PR, re-verifies it on a merge with the current
   base, merges, applies migrations, deploys, and checks production. That is
   the only path to live. If something feels urgent, it still goes through a
   PR — the integrator polls frequently.
4. Keep `npm run typecheck` and `npm test` green on your branch. New behavior
   ships with tests.
5. Migrations: one timestamped file per PR, additive when possible, explicit
   column grants, and a fresh `revoke all … from anon` for every new table.
   Numbers are claimed by creating the file — take the next free one
   immediately (three collisions have already happened).
6. To talk to the integrator, comment on your PR — it reads comments every
   cycle. The integrator replies there too.

## Known parked work

- `feat/sms-twilio` stays unmerged on purpose: it would replace the live Brevo
  transport. The operator parked Twilio deliberately.

## Integrator duties (one agent, not you unless the operator said so)

- Poll for new PRs, review the full diff, re-run typecheck + tests on a local
  merge with the current base, merge (merge commit, no squash), apply any
  migration, deploy with `npx vercel --prod --yes` from the repo root, then
  verify https://lefta.app responds.
- Check `supabase_migrations.schema_migrations` against
  `ls supabase/migrations` before every deploy — merged code has shipped ahead
  of its migration twice already.
- Leaving a branch unmerged is a decision and belongs in the report, not in
  silence.
