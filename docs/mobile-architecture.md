# lefta.app — native mobile app architecture

The mobile app is for the **tenant** (the creditor running their receivables), not
the debtor. A debtor's entire journey is one payment link, and a link that opens
instantly in any browser beats any app install — the web pay page stays the only
debtor surface. What the tenant actually needs on a phone is: *who owes me what,
what happened overnight, nudge someone now, and tell me the moment money lands.*

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Expo (React Native), TypeScript strict, expo-router** | One codebase for iOS + Android; the team already ships Expo apps; OTA updates for copy/screen fixes without store review |
| Auth + data | **@supabase/supabase-js** (anon key, RLS) | The web app already proved the RLS model; the phone is just another RLS-constrained client |
| Session storage | **expo-secure-store** | Tokens live in Keychain/Keystore, never AsyncStorage |
| Server ops | The existing **Next.js API routes** | Everything privileged (sync, reminders, credentials) already lives behind them; the app never holds a service key |
| State/data | **TanStack Query** + Supabase Realtime | Query cache doubles as the offline read cache; realtime flips an invoice to paid live |
| Push | **Expo Notifications** | The one genuinely new backend piece (see below) |
| Payments UI | **expo-web-browser** → Stripe Checkout | Card entry stays on Stripe's page, exactly like the web |

## Trust model — unchanged, and that is the point

The web app has three trust levels (browser/anon, server/anon-with-session,
server/service-role). The mobile app introduces **no new level**: it is the
"browser" tier on a different device.

- **Reads** go straight to Supabase under RLS: invoices, debtors,
  `dunning_contacts`, `communications_log`, the tenant's own profile columns.
  Column grants already keep ciphertext keys and settlement fields unreachable,
  so a stolen phone session leaks no more than a stolen browser session.
- **Writes that RLS allows** (debtor contact details, mute, due-date corrections,
  profile fields) also go straight to Supabase.
- **Everything privileged** goes through the Next.js API routes the web already
  uses: myDATA/Elorus sync, credential storage, manual reminders, mark-paid.
  Provider keys, encryption key and the service role never leave the server.

### One server-side prerequisite: bearer auth on the API routes

The API routes authenticate via `@supabase/ssr` **cookies**. A native app has no
cookie jar shared with the site; it holds a Supabase access token. Before the
app can call `/api/*`, the server needs a small adapter:

```
Authorization: Bearer <supabase access_token>
```

→ `getSessionUser()` grows a fallback: if there is no cookie session, read the
bearer token and resolve it with `supabase.auth.getUser(jwt)`. Same user object,
same downstream code. This is a ~20-line change in `lib/supabase/server.ts` and
is the only web-repo change Phase 1 strictly requires besides push.

### Server actions are not an API

`markInvoicePaid`, `sendReminder`, `previewReminder`, `updateProfile` are Next.js
**server actions** — an internal RPC between a Next page and its server, not a
public contract. The mobile app must not try to imitate the action protocol.
Each action the app needs gets a thin REST wrapper that calls the same
underlying function:

| Route (new) | Wraps |
|---|---|
| `POST /api/invoices/mark-paid` | `markInvoicePaid` ownership-checked settlement |
| `POST /api/reminders/preview` | `previewManualReminder` |
| `POST /api/reminders/send` | `sendManualReminder` (all compliance locks apply) |

The dunning ladder, the once-per-day lock and credit accounting stay server-side;
the app only ever asks, never enforces.

## Push notifications (the new backend piece)

The highest-value mobile feature is *"Παπαδόπουλος ΑΕ πλήρωσε 1.240,00 €"* on the
lock screen.

- New table `device_push_tokens (user_id, expo_token, platform, last_seen_at)`,
  RLS-scoped to the owner; registered/refreshed on app start after sign-in.
- A small `lib/push/send.ts` on the server, called from the same seams that
  already exist:
  - `notifyPaymentReceived` → **payment received** (alongside the email);
  - end of the nightly sweep → **sweep summary** ("3 υπενθυμίσεις στάλθηκαν");
  - a sync failure → **attention needed**.
- Delivery through Expo's push service; tokens that bounce are pruned.

No notification carries amounts+names beyond what the user already consented to
see on their lock screen (configurable: full detail vs. "Νέα πληρωμή").

## Offline

Read-only offline, deliberately. The query cache (TanStack persister on top of
MMKV) keeps the last-known dashboard, invoice list and customer list readable in
a basement or on a ferry. **Mutations are online-only**: queueing "send a
reminder" or "mark paid" offline and replaying it later would race the daily
contact lock and the settlement guards from a stale view of the world. The
compliance locks in Postgres would still hold — but the user experience of a
reminder firing six hours after the tap is worse than a disabled button.

## Screens (expo-router)

```
app/
  (auth)/sign-in, sign-up          # Supabase email+password, same accounts as web
  (tabs)/
    index                          # Επισκόπηση: KPI tiles, aging strip, recent payments
    invoices/ + invoices/[id]      # list w/ aging; detail: status, ladder history, actions
    debtors/  + debtors/[id]       # list; detail: contact fields, mute, open documents
    activity                       # communications_log, read-only
    settings                       # profile, language, integration status (read-only v1)
```

Design language mirrors the web (ink slate + brand blue, tabular figures in
columns, the aging strip) so the two surfaces read as one product. The i18n
dictionaries and the pure helpers (`money.ts`, `aging.ts`, `dunning/status.ts`,
`pay-code.ts`, `types/database.ts`) are dependency-free TypeScript — they move
to a shared package rather than being copied:

```
pnpm workspace:
  apps/web      (the current Next.js app)
  apps/mobile   (Expo)
  packages/core (money, aging, status, pay-code, db types, i18n dictionaries)
```

## Store-policy note: SMS credits

SMS credits are a B2B service consumed **outside the app** (messages sent by the
platform), which is the category Apple's rule 3.1.3(e) treats as eligible for
external purchase — but it is reviewer-interpreted territory. v1 ships the safe
shape: the app **shows** the balance and low-balance warnings; topping up hands
off to the web portal in the browser. No IAP, no Checkout inside the app.

## Deliberately out of scope for the app

- Template editing (long-form Greek copywriting is a desktop task; v1 shows
  which slots are customised).
- myDATA/Elorus credential entry (typing a subscription key on a phone invites
  typos into the most annoying-to-debug integration; the app deep-links to the
  web settings page).
- Any dunning logic, credit math or provider calls client-side.

## Phasing

1. **Read + push.** Sign-in, dashboard, invoices, customers, activity; payment
   push. Needs: bearer-auth adapter, push table + sender. *(This alone is the
   product's mobile value.)*
2. **Act.** Manual reminder (preview → send), mark paid, mute, edit contact
   details, correct due dates.
3. **Manage.** Sync triggers, integration status, SMS balance + web top-up
   hand-off, biometric app lock.
4. **Polish.** Home-screen widget (outstanding/overdue), live activities for
   sync runs, offline cache tuning.
