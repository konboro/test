# lefta.app — AI voice reminders

Fully automated reminder calls, built in-house. Legal review is done (owner's
call, 2026-08-19): the **creditor is the operator of the call** — lefta places
it on their behalf and from their identity, the same arrangement email and SMS
already use. Everything below is engineered so that arrangement stays visibly
true: the caller ID is the creditor's, the script speaks for the creditor, and
the platform's compliance locks bind voice exactly as they bind every other
channel.

## What the agent is allowed to be

An informer with a payment link, not a negotiator. The conversation policy is
a whitelist:

- state who is calling, **that it is an automated assistant** (AI-disclosure is
  non-negotiable), and on whose behalf;
- **verify the person first** — debt details only after the callee confirms
  they are the debtor (or their company). Anyone else hears only "please have X
  contact [creditor]": disclosing a debt to a third party is the classic
  collections violation, and it is guarded in the prompt AND in the tool layer;
- state document, amount, due date; answer "repeat", "when", "how do I pay";
- offer actions, each a **tool with server-side effect**, never free text:
  `send_payment_link` (SMS via the existing dispatch, same channel tag `?c=v`),
  `register_dispute` (flags the invoice, suggests mute to the tenant),
  `opt_out` (mutes the debtor — the existing auditable escape hatch),
  `request_callback` (notifies the tenant), `end_call`;
- refuse everything else: no payment plans, no discounts, no deadlines, no
  legal language, no promises. Hard-coded refusal lines, not model judgement.

## Architecture

```
engine (claims contact, channel='voice')            existing Next.js app
        │ insert voice_calls row
        ▼
services/voice-gateway  ──REST──▶  Twilio (call from the CREDITOR's number, AMD on)
        ▲                              │  answered
        │ WebSocket (ConversationRelay: streaming STT ⇄ text ⇄ streaming TTS,
        │                              barge-in, no audio handling on our side)
        ▼
   per-turn loop: transcript → guardrailed Claude call (tools) → sentence out
        │
        ▼ outcomes: communications_log (channel voice, transcript), funnel_events,
          voice_calls status, credits
```

- **`services/voice-gateway`** — a small persistent Node/TypeScript service
  (Fly.io or the Hetzner pattern from Penny). It cannot live on Vercel:
  ConversationRelay speaks WebSocket for the whole call. The gateway holds no
  secrets beyond its own Twilio + Anthropic keys and a service-role key; every
  DB write re-checks the voice_calls row it was dispatched for.
- **[Twilio ConversationRelay](https://www.twilio.com/en-us/products/conversational-ai/conversationrelay)**
  does STT/TTS/interruptions at $0.07/min and hands us text — we keep full
  control of the brain (the guardrails ARE the product here, so BYO-LLM beats
  any all-in-one voice-agent vendor). Day-1 spike: confirm `el-GR` STT quality
  and pick a Greek TTS voice from CR's Google/Amazon options — this is the one
  assumption that must survive contact with reality before anything else is
  built.
- **Caller identity**: per-tenant. Either a Twilio Greek number provisioned for
  the tenant (~$1.15/mo + regulatory bundle) or Twilio **verified caller ID**
  showing the creditor's own existing number — the second is what makes
  "operator = creditor" visible on the debtor's screen.

### The brain

One Claude call per conversational turn, streaming, with the system prompt
frozen and cached (prompt caching: stable prefix = persona + rules + tool
definitions; volatile suffix = invoice facts + transcript):

- Model: `claude-opus-5` (default per our API guidance), `output_config:
  {effort: "low"}` for latency, adaptive thinking left on, strict tools,
  sentence-chunked streaming into CR so speech starts before the turn is done.
  `claude-haiku-4-5` is the cheaper/faster fallback if measured turn latency
  demands it — measure first, both are pennies per call (below).
- Turn budget: max 10 turns or 4 minutes, then a polite scripted close.
- Every tool result and the full transcript land in `communications_log`
  (channel `voice`, content = transcript) — same append-only audit trail.
  **No audio recording** in v1: transcripts only, 12-month retention with the
  funnel events.

### Where the existing machinery already covers voice

- `comm_channel` gains `'voice'` (own migration — enum values cannot be added
  and used in one transaction). The daily contact lock, per-step uniqueness,
  scenario configuration, mute, quiet hours and the `UNSAFE_*` test flag all
  apply unchanged.
- One claimed contact = one notification event = up to 3 dial attempts spaced
  through the allowed hours, then optional SMS fallback under the same
  `contact_id` — the same "one contact may fan out" rule steps 2–3 already use.
- Voicemail (AMD): no debt details ever; hang up and count the attempt.
- Funnel: `call_answered`, `call_action:<tool>` events; the dashboard's channel
  table gets a voice row for free.
- Billing: voice credits per started minute, same ledger pattern as SMS
  (reserve → refund on failure).

## Costs

LLM prices from the current Anthropic price list; telephony from Twilio's
Greece page (2026-08). A 3-minute answered call, ~8 turns:

| Component | Rate | Per call |
|---|---|---|
| Twilio outbound, Greek mobile | [$0.0746/min](https://www.twilio.com/en-us/voice/pricing/gr) | ~$0.22 |
| ConversationRelay (STT+TTS+orchestration) | [$0.07/min](https://www.twilio.com/en-us/products/conversational-ai/pricing) | ~$0.21 |
| Claude Opus 5 brain ($5/$25 per MTok, system prompt cached ~90%) | ~$0.005/turn | ~$0.04 |
| **Total, answered 3-min call** | | **≈ $0.47 (~0.44 €)** |

- Haiku 4.5 brain: ~$0.008/call — total barely moves; choose on latency, not cost.
- **Voice pricing**: the $0.07/min CR rate covers the standard TTS providers, so
  the Google `el-GR` voice adds nothing. ElevenLabs in CR is public beta with
  no published CR rate yet — reference points are ElevenLabs' own ~$0.05/1k
  chars (≈ $0.13–0.15 of spoken agent text per 3-min call) and $0.08–0.10/min
  on their conversational plans, so budget **+$0.10–0.30/call** for the nicer
  voice and confirm the real number in M0. TODO(verify at M0).
- The scenario layer costs nothing at runtime — state machine and renderSpeech
  are code. The guardrail harness is text-only Claude: a full regression over
  ~50 golden/adversarial transcripts costs well under $2 per run.
- Unanswered attempt: a few cents (call setup + AMD seconds, no CR minutes).
- Landline instead of mobile: −$0.16/call ($0.0214/min).
- Fixed: Greek number from ~$1.15/mo per tenant (regulatory bundle takes days —
  start early), gateway hosting ~€5–20/mo, Twilio account.
- **Penny's 150 debtors**: one full wave ≈ 150 × (0.44 € × ~60% answer rate +
  ~0.03 € × retries) ≈ **45–70 € per campaign**. The run cost is noise; the real
  cost is the build.

Build estimate: gateway + tool layer + guardrails + Greek voice spike +
eval harness + supervised pilot ≈ **3–4 weeks of focused engineering**, most of
it in the last two items — the telephony plumbing is days, making the agent
boringly predictable is the work.

## Voice design

ConversationRelay offers three TTS providers: Google, Amazon Polly, ElevenLabs.
Polly has **no Greek voice**, so the real choice is:

- **Google `el-GR`** — one Wavenet voice (female). Correct, slightly official
  tone — arguably right for the subject matter. Full SSML support.
- **ElevenLabs (Flash 2.5, CR public beta)** — Greek among its languages, far
  more natural, big voice catalogue; also the only provider CR allows for
  automatic language detection. Trade-offs: near-zero SSML (formatting must be
  done in text), beta status on the money path.

M0 decides between them **over a real phone call** — telephone audio is 8 kHz
μ-law, which flattens studio-demo differences; pick by handset listening, not
by web demos. One platform voice for all tenants ("the assistant of X" is the
identity, so the voice belongs to the platform); no voice cloning, ever.

**Text-to-speech normalisation is its own renderer.** TTS reads "1.234,56 €",
"ΤΠΥ Α-1042" and "15/07/2026" wrong. Alongside renderEmail/renderSms there is a
`renderSpeech` layer: amounts spoken out in Greek words, dates as spoken dates,
document numbers spelled character by character, deliberate pauses (SSML on
Google; punctuation on ElevenLabs). Same `{{placeholders}}`, different surface
— and unit-testable exactly like the SMS segment counter.

**Latency choreography:** the opening line is a rendered template, played
immediately — the LLM only enters from turn 2. Replies stream sentence by
sentence; barge-in is CR's job. STT stays pinned to `el-GR` (code-switching is
where phone STT breaks); if the callee answers in English, the agent has one
scripted English line and the LLM continues in simple English — full
auto-detection (ElevenLabs `multi`) is a v2 experiment. M0 must also test STT
on the hard vocabulary: spoken amounts, dates, ΑΦΜ digits, Greek surnames.

## Conversation scenarios

Not a free chat: a **state machine with the LLM inside the states**. States are
fixed in code; the model understands and phrases, the machine decides what is
allowed to happen next:

```
OPENING (scripted template — who calls, that it's an automated assistant)
   → IDENTIFY (confirm the right person/company; nothing else may be said)
   → DISCLOSE (document, amount, due date — rendered facts, not free recall)
   → RESOLVE (loop: answer whitelisted questions, offer tool actions)
   → CLOSE (scripted; always states how to pay)
```

Transitions fire on tools and classified intents, never on prose — the tool
layer *is* the intent classifier, so there is no separate NLU to drift.

**Voice copy is platform-fixed in v1** — deliberately unlike email/SMS, where
tenants edit the wording. A spoken sentence is the compliance surface (tone,
implied promises), and the guardrail harness certifies *our* copy; a tenant
edit would be an untested script in lefta's voice. Tenants parameterise data
only: name, document, amount, date — the same tokens templates already use.

Branches that get scripted, each one a golden transcript in the harness:

| Branch | Behaviour |
|---|---|
| right person confirms | proceed to DISCLOSE |
| wrong person / refuses to confirm | "please have X contact [creditor]", end; no debt details |
| company receptionist ("ποιος τον ζητάει;") | creditor name only, ask for the person or offer callback |
| voicemail (AMD) | hang up, count attempt; no debt details |
| silence / unintelligible ×2 | polite close |
| "call me later" | `request_callback`, close |
| "I already paid" | no argument, no promise — "it will be checked", flag to tenant, close |
| dispute ("δεν το χρωστάω") | `register_dispute`, suggest-mute flag, close |
| asks for discount / instalments | scripted refusal + `send_payment_link`, close |
| "where did you get my number?" | scripted GDPR line (data from the creditor, for this debt) |
| abuse | one de-escalation line, then close |
| asks for a human | `request_callback`, close |

Turn counter and wall-clock live in the state (max 10 turns / 4 min → CLOSE),
so a looping conversation physically cannot happen.

## The fully in-house variant

Everything above assumes ConversationRelay carries the audio. Building that
layer ourselves replaces exactly one box in the architecture — the transport —
and none of the product: the state machine, tools, renderSpeech, guardrails,
logging and funnel wiring are identical. The gateway's transport is therefore
written as an interface from day one, so this section is a swap, not a rewrite.

**The stack:**

- **Telephony**: a Greek SIP trunk (Modulus-class B2B VoIP) — creditor's own
  number as caller ID, mobile termination at €0.005–0.02/min instead of
  Twilio's $0.0746.
- **Media & orchestration** — two credible shapes:
  - **jambonz** — open-source, self-hosted "ConversationRelay": SIP in, BYO
    STT/TTS/LLM, a WebSocket API so close to CR's that the gateway barely
    notices the migration. Least new code.
  - **LiveKit Agents / pipecat** — agent frameworks with VAD (Silero),
    turn-taking and barge-in as libraries plus a SIP bridge. More control,
    more code.
- **STT**: Deepgram **nova-3 streaming, Greek confirmed** (~$0.006–0.008/min).
  Self-hosted Whisper is the fallback, but real-time endpointing becomes our
  problem.
- **TTS**: Azure neural `el-GR` (Athina/Nestoras — a *better* Greek voice
  selection than CR's Google-only option) at ~$16/1M chars ≈ $0.05/call; or
  ElevenLabs API directly.
- **AMD** — the one thing nobody hands us: Twilio's answering-machine
  detection stays behind. Self-hosted AMD is greeting-length + beep heuristics
  or a small classifier, and it must be built and tested (a voicemail that
  hears debt details is a compliance failure, not a UX bug).

**Cost per answered 3-minute call:** trunk €0.015–0.06 + STT ~$0.02 + TTS
~$0.05 + Claude ~$0.04 ≈ **€0.12–0.20** (vs €0.44 on CR), plus a fixed EU
server €20–50/mo. Latency can actually *improve* — an EU-hosted media stack
next to a Greek trunk beats CR round-trips — and the GDPR posture is cleaner:
audio never leaves processors we chose.

**The price is ops, not code:** +2–3 weeks build (media plumbing, AMD, latency
tuning) and a **permanent tax** — SIP debugging, codec issues, media-server
upkeep and HA are ours forever, where CR's are Twilio's. Break-even stays
where the BYOC note put it: roughly 5–10k min/month across tenants, or earlier
if M0 finds CR's Greek quality wanting.

**Decision rule:** pilot on CR (M0–M3 unchanged) with the transport interface
in place; go in-house when multi-tenant volume, latency or data-residency
demands it — jambonz first, LiveKit/pipecat if we outgrow it.

## Training our own voice model

Three tiers, and only the middle one is a business decision rather than a
research program or a shortcut:

1. **True from-scratch pretraining** — tens of thousands of hours of speech, a
   GPU cluster for months, a speech-ML team; $0.5–5M before the first usable
   voice. This is ElevenLabs' business, not a feature of ours. Not on the table.
2. **New-language fine-tune of an open model — the realistic "own model".**
   XTTS-v2 has a documented precedent (Persian was added by fine-tuning the GPT
   component with the rest frozen); F5-TTS and Orpheus are the current
   quality leaders and fine-tunable. Greek is NOT among XTTS-v2's 17 stock
   languages, so this is a genuine language addition, in two data layers:
   - *language layer*: every public Greek speech corpus we can assemble
     (Common Voice el, CSS10, LibriVox audiobooks, parliament recordings —
     realistically 50–200 h after cleaning);
   - *brand-voice layer*: 5–20 h of studio recordings from a hired voice actor
     with a **full buy-out licence** — this is what makes the voice ours, and
     it is the honest version of "own voice" (a licensed human, not a clone).
   Compute is small (one A100/H100 for days–2 weeks, €500–3k rented); the real
   work is the data pipeline, Greek phonemization/stress handling and evals —
   one audio-experienced ML engineer, 6–10 weeks. Serving: one inference GPU
   (~€150–400/mo) streams sentences fast enough for the call loop.
3. **Piper/VITS trained only on our studio data** — a small per-voice model,
   days of training, **CPU inference**. Ceiling is "clean and pleasant", not
   "ElevenLabs" — but see the phone reality below.

**Budget for tier 2**: voice actor + studio €5–15k, engineering €15–35k,
compute €1–3k, serving €2–5k/yr → **€25–60k to the first production voice**,
then a near-zero marginal cost per minute.

**Phone reality check:** calls are 8 kHz μ-law. Most of the audible difference
between a premium model and a well-trained mid-tier voice is above that band —
over a handset, tier 3 gets surprisingly close to tier 2. Which means the case
for an own model is **never cost or audible quality alone** (Azure TTS costs
~$0.05/call; break-even sits at hundreds of thousands of calls): it is brand
ownership of the voice, vendor independence, data residency, and the option to
serve fully offline.

**Own STT — no.** Whisper/Deepgram fine-tuning would need in-domain telephone
audio, and our v1 policy deliberately records nothing — there is no training
corpus to build on. If this ever changes it changes as a consent decision
first, an ML decision second.

**Sequencing:** this slots in *behind* the TTS interface renderSpeech already
targets — the pilot runs on CR/Azure voices, the own-voice project can start
in parallel (actor casting + data assembly first), and swapping the voice
later is a config change, not a migration.

### Ex-mining GPUs

Owned mining-rig cards change the economics of tiers 2–3 and of self-hosted
inference — with hard caveats:

- **Only NVIDIA counts.** The whole stack (XTTS/F5/Orpheus training,
  faster-whisper, TTS serving) assumes CUDA; AMD mining cards (RX 5xx/5700)
  are effectively scrap for this — sell them and fund the voice actor.
- **Card tiers:** RTX 3090 (24 GB) is the mining-era gem — trains the tier-2
  Greek fine-tune outright (1–3 weeks wall-clock vs days on H100; time is
  cheap, the run is unattended) and serves streaming TTS + STT in real time.
  3080/3080 Ti: inference and LoRA training. 8–12 GB Turing/Ampere: dev boxes
  and faster-whisper inference. Pascal (10xx): fp32-only and slow — usable for
  Piper/VITS training and Whisper int8, nothing bigger.
- **What it deletes from the budget:** training rental (€1–3k → electricity),
  the serving GPU (€150–400/mo → ~€30–75/mo of power at ~250–350 W; undervolt
  — mining habits apply), and Deepgram (~$0.007/min → self-hosted
  faster-whisper at ~zero marginal). Combined with the in-house transport this
  puts an answered 3-minute call at **~€0.05–0.10 all-in** (trunk + Claude).
- **The real benefit is iteration freedom:** the fine-tune project is
  experiment-heavy, and owned hardware removes per-hour anxiety from every
  failed run.
- **Caveats that stay:** production serving wants to live next to the media
  stack (colo or a business line + UPS — a rig on home internet is jitter on
  the money path); consumer cards mean no ECC and no HA, acceptable for the
  pilot and the training lab, not as the only prod box; ex-mining units need
  fans/paste service and a VRAM stress test before being trusted.

## Guardrail testing is a deliverable, not a phase

- A **simulator harness**: the same gateway loop driven by text (no telephony),
  so every conversation policy is a unit test. Golden transcripts for the happy
  paths; adversarial set in Greek ("δώσε μου έκπτωση", "ποιος σου έδωσε το
  νούμερό μου;", "δεν είμαι αυτός", abuse, silence, answering machine speech).
- Assertions run on TOOLS, not prose: the model may phrase freely inside the
  policy, but a test fails if a forbidden tool fires, a debt detail precedes
  identity confirmation, or a closing line is missing.
- Pilot: `voice_enabled` flag per tenant, first campaign (Penny) with live
  transcript tailing and a kill switch (`automation_enabled` already exists);
  recordings stay off, transcripts reviewed daily for the first week.

## Milestones

1. **M0 — spikes (days)**: el-GR STT/TTS quality through ConversationRelay with
   a real Greek phone; Greek number/verified caller ID paperwork started.
2. **M1 — rails (week)**: `voice` enum + `voice_calls` + credits migrations,
   gateway skeleton, scripted (non-AI) TTS call end-to-end with AMD, logging,
   funnel events. This alone is already a shippable "automat" without the AI.
3. **M2 — the agent (1–2 weeks)**: Claude turn loop, tool layer, guardrails,
   simulator harness green on the adversarial set.
4. **M3 — pilot (week)**: supervised Penny campaign, latency/quality tuning,
   answer-rate and paid-within-7d measured against SMS/email in the existing
   funnel before deciding where voice sits in the scenario.
