# Second Look — Household Care Reconciliation for Alexa+
**Product Requirements Document (PRD) — v1.1** (supersedes v1.0)

> **Name:** Second Look. Tagline: *"Did we get it right today?"*
> **Repo:** `github.com/Divyanshu-kumar14/second-look` · **Demo voice lines:** *"Alexa, give Dad's meds a second look."* / *"Alexa, can Tom give Dad his ibuprofen?"*
> **Status:** Build-ready. **Primary track:** Amazon Developer Hackathon — **Alexa+**. **Minis:** see §12.1 (they stack with the track prize).
> **Deadline:** Oct 23 2026, 12:00pm PDT = **Oct 24, 00:30 IST**. **Internal freeze:** Oct 23, 18:00 IST (05:30 PDT).
> **Elevator:** *Ask Alexa one question — "are we doing this right?" — and hear the one thing that's off, the evidence behind it, and who can fix it. Ask before you give a pill and it tells you if the plan has changed. When someone without authority tries to change the plan, it says no — and tells them who can say yes.*

**Evidence tags used in this document:** `[verified]` = checked against a primary/authoritative page during v1.1 validation (sources in Appendix C) · `[inference]` = reasoned, not directly sourced · `[unverified]` = could not be confirmed; do not cite externally.

---

## 0. What changed from v1.0

| # | Change | Why |
|---|---|---|
| 1 | Removed 4 statistics; re-sourced the problem section | The 22.2%→16.0% figure is a 29-patient COPD pilot (not the cited journal); ~90%, 52.7% and Swiss Med Wkly "¼" could not be located. See Appendix C |
| 2 | Corrected Alexa Together facts | Amazon's notice: no longer available (update May 21, 2025); it was a paid subscription. v1.0 said "~Jun 2024" and "unpaid" |
| 3 | "Layer is open" → caution on willingness-to-pay | Amazon retired a paid caregiver subscription; that is a warning, not an opening |
| 4 | **Speaker identity specified** (bearer-token persona) | v1.0's headline refusal had no mechanism for knowing who is speaking |
| 5 | **Demo language path specified** (phrasing layer, real mic input, optional Bedrock router, third-party-client clip) | v1.0 had no component that turns speech into tool calls or records into a sentence |
| 6 | Tools 9 → 8: added `check_dose`; removed `who_can_do`, `get_audit_log` | Amazon's design guide: one intent per tool, avoid overlap. Prevention ("can I give this?") beats forensics |
| 7 | Rules: fixed R5 trigger, split out R6, R1 severity corrected, R4 gains a latent (pre-dose) mode | v1.0 fired R5 on a dose record (not a plan change); R1 "critical" for a 4h-vs-6h acetaminophen gap is alarm-fatigue bait |
| 8 | Findings are **grouped per medication** and ranked with a deterministic tie-break | Three critical rules hit the same ibuprofen doses; "one decision per turn" needs one finding |
| 9 | Fixture repaired | Priya is not a `clinician`; R2 on a discontinued drug made no sense; R5 had no real trigger |
| 10 | Storage: SQLite → append-only JSONL + hash chain | G5 said "no DB" while the stack used a native SQLite module; 300 events don't need SQL |
| 11 | PRM/OAuth theater removed; persona tokens added | Advertising auth metadata with no working auth server is worse than omitting it |
| 12 | Mini challenges: "$25K beats $5K" corrected | Rules allow one track prize **and** one mini prize per project; they are additive |
| 13 | Empty-result and blame-framing rules added | "Nothing found" must not sound like "all clear"; findings describe stale information, not culprits |
| 14 | Day-by-day schedule against the real deadline | 5 days remain; v1.0 had hours but no calendar |

---

## 1. Vision & Goals

### 1.1 Problem (scoped to what the evidence supports)
After hospital discharge, medication information is frequently wrong or misunderstood.
- In a prospective cohort of older adults discharged home (heart failure, acute coronary syndrome, pneumonia), **307 patients (81.4%)** had a provider reconciliation error or did not understand at least one intended medication change `[verified]` (Ziaeian et al., *J Gen Intern Med* 2012).
- Across **6,115** post-discharge reconciliations in Andalusian primary care, **73.7%** showed discrepancies and **50.6%** were classified as medication errors `[verified]` (González-López et al., *Applied Sciences* 2021).
- A retrospective study of pharmacist-led telephone post-discharge reconciliation in geriatric primary care found 30-day inpatient admission of **6.4% with the program vs 14.7% usual care** (OR 2.54) `[verified]` (Liu et al., *J Aging Health* 2018). Observational; association, not proof.

**Evidence gap `[inference]`:** these studies measure discharge-document and clinician-side discrepancies. The failure Second Look targets — a *stale instruction reaching the bedside*, or *someone without authority administering or changing* — is plausible given them but is **not directly measured** in the sources used. Never present the readmission figures as Second Look's effect.

### 1.2 Landscape
- Consumer tools — Medisafe ("Medfriend" missed-dose alerts), Jointly, Caring Village, Uncle's Pills — offer shared medication lists, reminders, missed-dose alerts and per-person dose logs `[verified: store listings and vendor comparison pages, May–Jul 2026; vendor-authored, not exhaustive]`.
- Shared dose logs already address naive double-dosing, so **R1 is not a differentiator.** The differentiators are R3 (superseded order still in use), R4 (plan-barred drug class), R5/R6 (role-based refusal and flagging) `[inference: not described in the listings reviewed]`.
- Clinician-side reconciliation is a professional workflow (CMS Medicare Advantage post-discharge reconciliation measure) `[unverified this pass — confirm before citing]`.
- **Amazon precedent:** Alexa Together was a paid caregiver subscription and is **no longer available** (Amazon notice dated May 21, 2025; Alexa Emergency Assist is the replacement) `[verified]`. Treat this as a caution on standalone willingness-to-pay, **not** proof that "the layer is open". Second Look differs in kind — an on-demand decision with provenance, not subscription monitoring `[inference]`.

### 1.3 Goals
- **G1** Make the household's care record **self-reconciling**: detect contradictions nobody would otherwise catch, without a clinician.
- **G2** **Voice-first, screen-optional.** Lead with one finding; every answer complete as audio alone.
- **G3** **Refuse** unauthorized plan changes, route the request to someone who can approve, and log the refusal as a first-class event. Identity comes from the token, never from tool arguments.
- **G4** Be a **conformant MCP server** (spec 2025-11-25, Streamable HTTP) any MCP client can call.
- **G5** **Zero-credential reproducibility:** `git clone && npm install && npm start`. No AWS account, no API keys, no database server, no native modules.
- **G6** **No LLM in the reasoning path.** Findings are computed, deterministic, and cite event IDs. An LLM is permitted only at the edges (optional utterance routing; future document intake) and may only restate fields present in a typed record.
- **G7** **Demo honesty.** The simulator is labelled as a simulator. The README states what real Alexa+ would supply (identity, speech) and what we substituted.

### 1.4 Non-goals
- Not a medical device, not clinical decision support, not HIPAA-regulated. Synthetic data only.
- Not an Alexa+ **add-on package**: `alexa-ai` CLI, MCP Toolkit, Category SDK and Web Simulator are in preview for select partners; participants cannot get access `[verified, Devpost FAQ]`. We ship a conformant MCP server and our own web MCP client, which the FAQ confirms satisfies the track.
- Not a reminder app, EHR/FHIR client, pharmacy integration, multi-tenant SaaS, or hosted service (server need not stay live post-submit `[verified, FAQ]`).
- Not a real OAuth 2.1 authorization server (§10.3).
- **Document/label intake** (photo → structured events) is out of the build; it is named as the top adoption risk (§12.2) and appears as roadmap only.

### 1.5 Success metrics
| Metric | Target | Why |
|---|---|---|
| Server-side tool latency | **p95 < 150ms** (Alexa+ budget is <500ms round trip `[verified]`) | HUD labels this "server time"; the 500ms budget also includes network `[inference]` |
| `npm start` cold start | < 8s, zero config, no native build | Judges run it themselves; a locally runnable repo suffices `[verified, FAQ]` |
| MCP conformance | `initialize`, `tools/list`, `tools/call` clean; Origin validated; session ID honored; verified with `curl` + MCP Inspector | Required spec ≥2025-11-25 `[verified]` |
| Core rules firing on fixture | **R1–R6 fire; R7–R8 stretch** | Depth is judged less than a polished slice |
| Unauthorized plan changes refused | **100%**, each with an audit event and a routed request | Core differentiator |
| Tool design | 8 tools, one intent each, no overlapping inputs | Amazon design guide `[verified]` |
| Demo video | **≤ 2:55**, English, public; best material in the first 60s | Judges need not watch past 3:00 `[verified]` |
| Test coverage | ≥90% lines on rules + authority, 100% on authority paths | Tech Implementation criterion |

---

## 2. Users & Journeys

**Personas (the household, not the patient):**
- **Priya** — adult daughter, 10 min away. Role `full`: may change the plan.
- **Tom** — adult son, evenings. Role `record`: may log doses and observations. Acts on the paper discharge summary.
- **Elena** — neighbour. Role `none`: read-only. Helped for 20 minutes.
- **Robert** — 74, post-hip-replacement, hypertension + CKD stage 3. The patient, not a user.

**Who is speaking:** the bearer token on each request maps to one persona (§5.4). The client has a persona switcher. Real Alexa+ would supply identity via account linking and voice profiles; the server cannot observe voice-profile mismatch (anyone in the room can speak) — documented limitation.

**Journeys**
- **J1 Prevention (new):** *Tom: "Alexa, can I give Dad his ibuprofen?"* → `check_dose` → verdict `DO_NOT_GIVE`: stopped Day 3, and the plan bars NSAIDs. Same rules engine, run on a hypothetical dose; nothing written.
- **J2 Second look (headline):** *Priya: "Alexa, give Dad's meds a second look."* → `find_problems` → one grouped finding: ibuprofen was stopped Day 3, yet 2 doses followed (Tom Day 5 from the discharge paper; Elena Day 5 evening); the plan bars NSAIDs for Robert. Framed as **stale information**, not fault.
- **J3 Refusal (money shot):** *Tom: "Alexa, double Robert's acetaminophen."* → `request_regimen_change` returns `status: refused`, `whoCan: Priya`, writes `authority.change_refused`, and leaves a **pending request visible to Priya**. Audit entry appears live.
- **J4 Handoff:** *Tom ends his shift.* → `get_handoff` returns SBAR-shaped transfer with `settled: false` and the unresolved items; it never presents gaps as settled.
- **J5 Recall:** *"Who gave ibuprofen on Friday?"* → `get_timeline` with lineage.
- **J0 Setup (out of demo):** events enter by voice/typing; document intake is roadmap.

---

## 3. Scope, Phases & Schedule

Deadline math: today is Sun Oct 18; freeze Fri Oct 23 18:00 IST. Estimates total ~28h; **plan for 1.5× (≈42h)** and use the cut lines in §12.3.

| Phase | Est. | Window (IST) | Exit criteria |
|---|---|---|---|
| **0 Foundations & contracts** | 3h | Oct 18 | One Node process on `:8787` serves `/mcp` and static client; SDK Streamable HTTP transport; Zod schemas shared; `Origin: https://evil.com` → 403; handshake with zero env vars |
| **1 Event log & state** | 4h | Oct 18–19 | Append-only JSONL with hash chain; `fold()` deterministic with provenance; authority model; tamper test fails verification |
| **2 Rules engine** | 5h | Oct 19–20 | R1–R6 pure, unit + integration tested; grouping + ranking deterministic; fixture fires all |
| **3 MCP tool surface** | 4h | Oct 20 | 8 tools, `outputSchema`, structured results and errors; p95 < 150ms; curl + Inspector transcripts saved |
| **4 Demo client** | 7h | Oct 21 | Persona switcher, transcript, phrasing layer, mic in / speech out (optional), evidence drawer, audit log, protocol inspector, latency HUD |
| **5 Hardening & submission** | 5h | Oct 22–23 | Clean-container run, README, video, product feedback, friction log, mini-challenge claims |

Rolling tasks: **start the friction log on Oct 18** and append as you hit friction (up to a 10% judging bonus `[verified]`). Mini-challenge go/no-go: **Oct 21 EOD**. Submit by **Oct 23, 18:00 IST**.

---

## 4. UX Requirements

Design basis (Amazon Alexa+ MCP design guide `[verified]`): customers arrive by voice or touch, often multitasking; one tool = one customer intent; avoid overlapping tools; **you cannot script what Alexa says — you design the data it speaks from.** Responses may be visual and/or spoken; voice-only must work. (v1.0 quoted additional guide lines — "one decision per turn", the structured-errors sentence — that were not located in the pages retrieved; they are treated as our own design principles, not citations.)

- **One finding per turn.** Rank, lead with one (≤ 25 words as spoken), offer "why?" (→ `explain_problem`).
- **Describe stale information, not culprits.** Actor appears as provenance ("recorded by Tom, from the discharge paper"), never as the cause. Root cause is the superseded instruction.
- **No false reassurance.** Empty results return coverage, not comfort: *"I found no conflicts in the 212 events on record, but 3 expected doses today aren't logged."* Never "everything's fine."
- **Refusal feels safe, not broken.** State the constraint, the reason, who can do it, and what happens next ("I've asked Priya to approve it"). Never a bare error.
- **Screen-optional.** Every answer complete as audio; screen adds evidence.
- **Confirm, don't decorate.** Inline UI only to confirm an action or show evidence. MCP Apps / `ui://` is cut-first.
- **A11y:** WCAG 2.2 AA (4.5:1 text), keyboard-complete, `aria-expanded` evidence drawer, `prefers-reduced-motion`, transcript is real text with screen-reader labels.
- **Latency HUD** shows server time per call.

**Phrasing layer (client, simulated):** `client/phrase.ts` maps typed records to sentences by `ruleId` + `nextAction` enum. Default mode is deterministic templates, labelled in the UI "Simulated Alexa phrasing — Alexa+ generates its own." Optional `Bedrock` mode (§5.1) may only restate fields present in the record and must cite event IDs.

**Input:** default router is a deterministic utterance matcher (~10 patterns → tools), labelled "Simulated NLU". Optional browser `SpeechRecognition` for mic input and `speechSynthesis` for output; no API keys; typed fallback always works.

---

## 5. Architecture & Stack

### 5.1 Runtime
| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x, Node ≥22, ESM, `strict` | One toolchain for server and client |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport | Use what the SDK ships; do not hand-roll session, version, or Origin handling unless a gap is proven |
| Validation | Zod → JSON Schema (`inputSchema` and `outputSchema`) | One source of truth |
| Store | **Append-only JSONL + in-memory fold**, SHA-256 hash chain | Zero native deps, byte-identical seed, tamper-evident; ~300 events |
| HTTP | Express or `node:http` | `/mcp` and static client on one port |
| Client | React 19 + Vite, built static | No dev server or CDN at judge time |
| Tests | Vitest | Native TS/ESM |
| UI | Hand-rolled CSS + tokens | No framework drift |
| Optional agent | `npm run start:agent` — Node endpoint using AWS SDK/Bedrock for utterance → tool routing | Off by default; needs AWS credentials; never touches `/mcp`; documents an AWS integration for the AWS Builder mini |

### 5.2 Repo layout
```
second-look/
├── package.json        # "start": serves /mcp + ./dist
├── README.md           # judge command in first 20 lines
├── LICENSE             # MIT
├── server/
│   ├── index.ts        # HTTP entry: /mcp + static
│   ├── mcp.ts          # SDK transport + tool registration
│   ├── identity.ts     # bearer token -> caregiver -> role
│   ├── log.ts          # append-only JSONL + hash chain + verify
│   ├── fold.ts         # events -> CareState (provenance-bearing)
│   ├── authority.ts    # role -> permissions, refusal logic
│   ├── formulary.ts    # static drug -> class map (synthetic, ~12 drugs)
│   ├── rules/          # pure modules + index.ts registry + group/rank
│   └── tools/          # 8 tool modules
├── client/             # React MCP client (router, phrase, inspector)
├── fixtures/scenario.ts
├── scripts/            # seed, verify-log, bench
└── tests/
```

### 5.3 Request path
`POST /mcp` → JSON-RPC parse → session lookup (in-memory Map, random UUID) → token → caregiver → tool handler → `fold(events)` (cached, invalidated on append) → rules → typed result. No network or model calls. Cold `fold` on ~300 events < 25ms.

### 5.4 Identity & authority (new)
- `Authorization: Bearer demo-priya | demo-tom | demo-elena` (non-secret, seeded in the fixture, labelled demo). **No token → `guest` (role `none`).** Zero-config handshake still works.
- **No tool takes an `actorId` argument.** A client-supplied actor would make refusals theater.
- `actorRole` on each event is **resolved server-side at write time**, never client-supplied.
- Real Alexa+ would supply the subject via OAuth account linking; the shared-speaker problem (voice profile mismatch) is outside what an MCP server can observe — stated in the README.

---

## 6. Domain Model & Rules Engine

### 6.1 Event envelope
```ts
{ eventId: string;       // uuid
  seq: number;           // monotonic, gaps forbidden
  ts: string;            // ISO-8601 UTC
  actorId: string;       // caregiver id, or "system:<source>"
  actorRole: "full" | "record" | "none";   // resolved server-side
  type: EventType;
  payload: object;
  supersedes?: string;   // eventId this corrects
  source: "clinician" | "pharmacy" | "caregiver" | "device" | "document";
  prevHash: string;      // hash of previous event
  hash: string; }        // sha256(prevHash + canonicalJson(rest))
```
No UPDATE or DELETE exists in the write API. Corrections are new superseding events. `npm run verify-log` recomputes the chain.

### 6.2 Event types (17)
`person.registered` · `caregiver.joined` · `caregiver.left` · `caregiver.authority_changed` · `plan.constraint_set` · `med.prescribed` · `med.changed` · `med.discontinued` · `med.dispensed` · `dose.recorded` · `dose.missed` · `observation.recorded` · `authority.change_requested` · `authority.change_refused` · `authority.change_applied` · `document.attached` · `problem.acknowledged`

### 6.3 Plan constraints & formulary
The system asserts **no clinical knowledge of its own** beyond a small synthetic formulary (drug → class) in code. Barred classes come from a **sourced `plan.constraint_set` event** (e.g. `{barredClasses:["NSAID"], reason:"CKD stage 3"}`, source `clinician`). General nephrology guidance discourages NSAIDs in CKD `[inference: not re-verified this pass]`; the product enforces the plan's constraint, it does not diagnose. `med.prescribed` may carry `maxDailyMg`.

### 6.4 Rules (pure functions over `CareState` and an `asOf` clock)
| ID | Name | Fires when | Severity |
|---|---|---|---|
| **R1** | `DOSE_INTERVAL` | Two doses of one medication closer than prescribed interval minus tolerance (default 30 min) | medium; **high** if rolling 24h total exceeds `maxDailyMg` |
| **R2** | `DISPENSE_MISMATCH` | Dispensed dose or form differs from the active prescription | high |
| **R3** | `SUPERSEDED_IN_USE` | A dose is recorded after that medication's discontinue/supersede event | critical |
| **R4** | `CLASS_BARRED_BY_PLAN` | Medication in a barred class is **prescribed** (latent) or **administered** | high (latent) / critical (administered) |
| **R5** | `UNAUTHORIZED_PLAN_CHANGE` | An `authority.change_refused` exists (requester role below `full`) | high |
| **R6** | `UNAUTHORIZED_ADMINISTRATION` | A dose is recorded by an actor with role `none` | medium |
| R7 *(stretch)* | `MISSED_DOSE_WINDOW` | Scheduled window closed without a record, beyond tolerance, relative to `asOf` | medium |
| R8 *(stretch)* | `OBSERVATION_DIVERGENCE` | Observation trends adversely after a med change with no recorded review | high |

Each rule returns `{ruleId, severity, what, evidence[eventIds], who, when, nextAction}`. `nextAction` is a machine-readable enum: `STOP_GIVING`, `CONTACT_PRESCRIBER`, `ASK_AUTHORIZED_CAREGIVER`, `CHECK_LABEL_WITH_PHARMACY`, `RECORD_MISSING_DOSE`, `ACKNOWLEDGE`.

**Recording is never blocked.** A real dose that happened must be loggable by anyone; `record_dose` accepts and flags (R6) rather than refusing. Only **plan changes** are refused.

### 6.5 Findings: grouping & ranking
- Rule hits **group per medication** (R5 per request) into one `Finding`: `{findingId, medicationId, rules[], severity = max, evidence = union}`. `findingId` = hash of sorted evidence IDs (stable, speakable "finding 1").
- **Rank:** severity desc → number of distinct rules desc → most recent evidence `ts` desc → `ruleId` asc. Fully deterministic; no `Date.now()` in the rule path.
- `problem.acknowledged` hides a finding from "new" but keeps it in handoffs as *acknowledged, unresolved* until its cause clears.

### 6.6 Provenance rule
Every `CareState` field carries `{value, eventId, actorId, ts, source}`. The server never emits an unsourced claim: the model phrases, we prove.

---

## 7. Fixture — seeded scenario

Generated by code (`npm run seed`), byte-identical. Synthetic "Robert Alvarez", 74, hip replacement 2026-09-28, hypertension + CKD stage 3. Frozen demo clock `asOf` = Day 8, 18:00.

| Day | Events | Findings |
|---|---|---|
| 1 | Registered; Priya `full`, Tom `record`, Elena `none`. `plan.constraint_set` NSAID barred (CKD 3; source clinician, nephrology note attached). Discharge summary prescribes **acetaminophen 500mg q6h** (`maxDailyMg` 3000) **and ibuprofen 800mg q6h PRN** (source document) | **R4 latent (high):** ibuprofen prescribed in a barred class — *catchable on Day 1* |
| 3 | Priya discontinues ibuprofen (`source: pharmacy`, basis "pharmacist call"; **not prescriber-confirmed**) | — |
| 4 | Elena requests acetaminophen every 4h → refused; Priya acknowledges | **R5** |
| 5 | Tom records ibuprofen 14:00 (`source: caregiver`, followed paper summary) | **R3 + R4 (critical)** |
| 5 eve | Elena records ibuprofen 20:00 | R3 + R4 + **R6**, same finding |
| 6 | Priya records acetaminophen 08:00; Tom 12:00 (4h later); Priya acknowledges | **R1 (medium)** |
| 7 | Pharmacy delivers acetaminophen **650mg ER** vs prescribed 500mg IR | **R2 (high)** |
| 7 *(stretch)* | No acetaminophen recorded 08:00–20:00 | R7 |

Open at handoff (3 unresolved): ibuprofen-after-stop finding; dispense mismatch; **discontinuation unconfirmed by prescriber** (derived gap). The live demo's refusal (Tom, "double") adds a second R5 entry on top of Elena's.

---

## 8. MCP Tool Surface (8 tools)

> Each tool = one customer intent. Descriptions are written as intents with example phrases, because Alexa selects tools from them `[verified]`. Every result carries `structuredContent` validated by `outputSchema` **and** the same JSON in a `text` content block (spec compatibility `[inference: verify against spec text]`). Tool failures return `isError: true` with a structured payload. A **refusal is a successful result**, not an error.

| Tool | Intent / example | Key input | Key output |
|---|---|---|---|
| `check_dose` | "Can Tom give Dad his ibuprofen?" Dry run, writes nothing | `{medicationId, amount?, at?}` | `{verdict: OK or CAUTION or DO_NOT_GIVE, reasons:[{ruleId, what, evidence[]}], nextAction}` |
| `record_dose` | "I gave Dad his Tylenol." | `{medicationId, amount, at?, note?}` | `{recorded, eventId, provenance, flags:[{ruleId, findingId}]}` |
| `request_regimen_change` | "Double Robert's acetaminophen." | `{medicationId, newDose?, newFrequency?, reason}` | `{status: applied or refused, refusal?:{code, whoCan, sinceWhen}, pendingRequestId?, eventId}` |
| `get_current_regimen` | "What is Dad on?" | `{personId}` | `{medications:[{id, name, dose, frequency, status, provenance[]}]}` |
| `find_problems` | "Are we doing this right?" **Headline.** | `{personId, since?, minSeverity?}` | `{findings:[{findingId, rules[], severity, what, evidence[], when, nextAction}], coverage:{scannedEvents, from, to, lastDoseAt, unloggedExpectedDoses}, assurance}` |
| `explain_problem` | "Why?" / "Show me." | `{findingId}` | `{rules[], derivation[], events[]}` |
| `get_timeline` | "Who gave ibuprofen Friday?" Also the audit log (filter `type: authority.*`) | `{personId, from?, to?, actorId?, type?}` | `{events:[...]}` |
| `get_handoff` | "Hand off to Priya." | `{personId, toCaregiverId}` | `{situation, background, assessment, recommendation, settled, unresolved:[{item, kind, blocking, whoMustResolve, evidence[]}]}` |

Notes: `assurance` is `NONE_FOUND_IN_RECORD` or `FINDINGS_PRESENT`, never "all clear". `settled` is `false` whenever `unresolved` is non-empty. Errors: `{code, message, missingFields[], suggestedFollowUp[]}` — never a stack trace.

---

## 9. Protocol Compliance — MCP `2025-11-25` Streamable HTTP *(hard requirement)*

The repo must call the MCP technology in code (entry point and tool registration), not merely mention it `[verified, Official Rules page]`. Single endpoint `POST|GET|DELETE /mcp`; prefer the SDK's transport, then verify each item below against the spec text and the running server.

1. **POST** with `Accept: application/json, text/event-stream`; body = one JSON-RPC message.
2. Respond with `application/json` or `text/event-stream`; support both.
3. If SSE: send a priming event with an ID and empty `data`; send `retry:` before closing so clients can resume via `Last-Event-ID`.
4. **`MCP-Session-Id`**: secure visible-ASCII UUID at init; client echoes it; **400** if missing on non-init, **404** if terminated.
5. **`MCP-Protocol-Version: 2025-11-25`** on later requests; absent → assume `2025-03-26`; invalid → **400**.
6. **Validate `Origin`** on all connections (DNS-rebinding defence); invalid → **403**.
7. Bind **127.0.0.1** by default.
8. `GET /mcp` → SSE stream or 405. `DELETE /mcp` + session ID → terminate or 405.
9. JSON-RPC is UTF-8; never send one message on multiple streams.

**Verification (paste into README):** raw `curl` of `initialize` → `tools/list` → one `tools/call`, plus an MCP Inspector session showing all 8 tools.

**Alexa+ add-on facts for the README `[verified, Amazon MCP quickstart]`:** Streamable HTTP; reachable remote URL; <500 ms round trip; OAuth 2.1 authorization-code with PKCE (S256); `resource` parameter set to the server's canonical URI; auth-server metadata at `/.well-known/oauth-authorization-server`; 401 without a `WWW-Authenticate` header for unauthenticated requests. These bind add-ons, not this submission; we document the gap rather than imitate it.

---

## 10. Security, Privacy & Compliance

### 10.1 Data
Fixture is 100% synthetic, generated in code. No real PHI ever enters the repo or demo.

### 10.2 Threat model — honest scoping
Household-owned record, not a clinical system. Realistic threats: (a) a layperson edits the plan without authority — handled by R5 and refusal; (b) a shared speaker lets the wrong person speak — **not detectable by the server**, documented; (c) the log file is edited on disk — the hash chain makes this detectable, not impossible.

### 10.3 Auth — deliberate, documented
No OAuth server. Identity = static demo persona tokens; no token = `guest`. We do **not** publish PRM/authorization-server metadata, because advertising auth we do not enforce misleads clients. README states why, and lists what a real add-on would need (§9).

### 10.4 Gates
No secrets in repo; `.env.example` empty. Zod validation on every tool; structured errors only. The JSONL file is gitignored; `fixtures/scenario.ts` is the source of truth.

---

## 11. NFRs
- **Latency:** p95 < 150ms server time; `find_problems` on 500 events < 50ms; displayed live.
- **Startup:** listening < 8s, no native compile.
- **Determinism:** identical events + `asOf` → byte-identical rule output. No `Date.now()` in the rule path; the demo clock is injected.
- **Accessibility:** WCAG 2.2 AA, keyboard-complete.
- **Portability:** Linux/macOS/Windows; pure-JS dependencies only.

---

## 12. Submission Checklist & Risks

### 12.1 Mini challenges (corrected)
Rules allow **one track prize and one mini-challenge prize per project** `[verified]`, so a mini is additive to the $25K/$15K/$4K Alexa+ prizes, not an alternative. Each mini pays $5K cash + $5K AWS credits + an Amazon Developer meeting.
- **AWS Builder** — qualifies with documented AWS integrations (e.g. Bedrock); Kiro Crew qualifies on its own `[verified]`. Cheapest path: the optional `start:agent` Bedrock router (§5.1). It also closes the demo's language gap, so build it once, claim it. $150 promo credits are available per participant via the form on the FAQ page `[verified]`.
- **Open Source** — a new additional open-source project or a branch/fork/PR to a public repo; unmerged is fine `[verified]`. Cheapest path: extract the pure rules engine + provenance fold into a separate MIT repo (`care-reconcile`, ~1.5h).
- **Go/no-go Oct 21 EOD**, only if Phases 0–3 are green. Default: AWS Builder yes (shared work), Open Source if ≥2h slack.

### 12.2 Risks (ranked)
| Risk | Class | Mitigation |
|---|---|---|
| Judges can't build or run it | fatal | One command, zero config, no native deps; verify on a clean container |
| MCP transport subtly non-conformant | fatal | SDK transport; §9 checklist; `curl` + Inspector transcripts in README |
| **Demo is a scripted chat skin** (no language or voice path) | fatal if unfixed | Phrasing layer, real mic/speech option, Bedrock router, and a short clip of a third-party assistant calling the same server (FAQ: a bonus `[verified]`) |
| **Refusal rests on undefined identity** | fatal if unfixed | Bearer-token personas; no `actorId` args (§5.4) |
| **Adoption: who enters the data?** Prescriptions, dispenses and labels must be typed or spoken by a layperson | blind spot (impact) | Name it in the video; roadmap = document/label intake with LLM **at the edge, human-confirmed**, deterministic core unchanged |
| Overclaiming evidence | fixable | Only §1.1 claims; Appendix C register |
| False reassurance on empty result | blind spot | `assurance` enum + `coverage` (§4) |
| Blame framing alienates families | blind spot | Stale-information framing (§4) |
| Tool overlap → wrong tool in real Alexa+ | fixable | 8 intent-scoped tools; example phrases in descriptions |
| Health-category add-on policy unknown | blind spot `[unverified]` | Frame as care-plan consistency; confirm policy before any real add-on attempt |
| "Amazon shipped and killed this" | high | Answer honestly: paid monitoring subscription retired; Second Look is an on-demand decision with evidence, and the claim is "different in kind", not "the layer is open" |
| Schedule slip | high | Cut lines §12.3; Phase 5 protected |
| MCP Apps / `ui://` eats time | med | Cut first |

### 12.3 Cut lines (in order)
1. MCP Apps inline UI → drop.
2. R7/R8 → drop (already stretch).
3. Open Source mini → drop.
4. `get_handoff` (J4) → drop; keep `settled` logic inside `find_problems`.
5. Optional mic/speech and Bedrock router → drop; keep deterministic router + phraser + third-party-client clip.
6. Protocol inspector → static header showing the handshake succeeded.
Never cut: `check_dose` or `find_problems`, refusal + audit, identity, README verification, friction log.

### 12.4 Submission artefacts
- [ ] GitHub repo, **MIT license**. **Prefer public** (no invitations needed beyond the license file). If private, add `chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar` at submission time; invitations expire in 7 days and each person must accept `[verified]`
- [ ] README: judge command in first 20 lines; synthetic-data and not-a-medical-device statements; what we simulate vs what Alexa+ supplies; why OAuth is out
- [ ] Demo video **< 3:00**, public, English, YouTube/Vimeo; no third-party trademarks or music
- [ ] Project description (what + how); state what was built during the window if any code pre-existed
- [ ] **Product feedback on every tool/API/SDK used** (required): what for, what worked, what needs work, onboarding, would you build again
- [ ] Tracks and mini challenges entered; if AWS: which services and how
- [ ] **Friction log** (optional, up to 10% bonus) and feature requests (optional)

---

## 13. Glossary
- **Reconciliation** — comparing what was prescribed, dispensed, and actually given, and flagging disagreement.
- **Provenance** — `{eventId, actorId, ts, source}` on every claimed fact.
- **Supersede** — a later event correcting an earlier one; the log is append-only so history survives.
- **Finding** — one or more rule hits grouped per medication.
- **SBAR** — Situation / Background / Assessment / Recommendation.
- **NSAID** — non-steroidal anti-inflammatory drug (ibuprofen, naproxen); generally avoided in CKD `[inference]`.
- **Streamable HTTP** — MCP transport replacing HTTP+SSE (2024-11-05).

---

## Appendix A — Demo Video Script (≤ 2:55)
| Time | Beat | Proof |
|---|---|---|
| 0:00 | One-line problem; protocol inspector shows `initialize` → `tools/list` over the wire | Real MCP server |
| 0:12 | **Priya (mic):** *"Alexa, give Dad's meds a second look."* → one grouped finding: ibuprofen stopped Day 3, 2 doses since; evidence drawer opens | Provenance, stale-info framing |
| 0:45 | **Switch to Tom:** *"Double Robert's acetaminophen."* → **REFUSED**; routed to Priya; audit entry appears live | **Money shot** |
| 1:15 | **Tom:** *"Can I give Dad his ibuprofen?"* → `DO_NOT_GIVE` with reasons | Prevention |
| 1:35 | *"Hand off to Priya."* → SBAR, `settled: false`, 3 unresolved *(cut line 4)* | Refuses to smooth over gaps |
| 1:55 | Same server called by a third-party assistant *(optional clip)* | Not demo-bound |
| 2:15 | Latency HUD (server time), determinism, "no LLM in the reasoning path" | Headroom vs 500ms |
| 2:35 | Honest limits: identity via tokens, data intake is roadmap; friction-log teaser | Judgment, not gaps |

## Appendix B — Definition of Done
1. `git clone && npm install && npm start` → client at `:8787`, MCP at `:8787/mcp`; **verified on a clean container with no environment variables**.
2. Raw `curl` transcript + MCP Inspector session for all 8 tools in README.
3. R1–R6 fire on the fixture; unit-tested; identical output across 3 runs.
4. Every unauthorized plan change is refused **and** logged **and** creates a pending request — integration test asserts all three.
5. `npm run verify-log` passes on a clean log and **fails** after a manual edit.
6. The demo runs without touching storage directly.
7. `find_problems` on an event set with no violations returns `NONE_FOUND_IN_RECORD` plus coverage (test).
8. README states: synthetic data, not a medical device, what is simulated, why OAuth is out.
9. Product feedback and friction log submitted; collaborators/license verified; submitted by Oct 23, 18:00 IST.

## Appendix C — Evidence Register
| Claim | Status | Source |
|---|---|---|
| Deadline Oct 23 12:00pm PDT; Alexa+ track = self-hosted MCP (2025-11-25+, Streamable HTTP), Agent Skill, or simulated experience; prizes $25K/$15K/$4K; minis $5K; four equal criteria (Tech Implementation, Design, Potential Impact, Quality of the Idea) | verified | amazonappdev2026.devpost.com |
| Repo must call MCP in code; locally runnable public repo suffices; web page acting as a real MCP client satisfies the track; add-on tooling is partner-only | verified | amazonappdev2026.devpost.com (overview, `/details/faqs`) |
| One track prize + one mini prize per project; Open Source mini accepts unmerged fork/PR; friction logs earn up to 10% bonus; collaborator list; 7-day invite expiry | verified | amazonappdev2026.devpost.com |
| Judges are mostly Amazon Devices/Alexa/Fire TV/Bee/Ring/AWS staff and evangelists; no clinicians listed | verified | amazonappdev2026.devpost.com |
| ~56.5K registrants (page counter, Oct 18). Registrants ≠ submissions; Alexa+ is one of four tracks | verified | amazonappdev2026.devpost.com |
| Alexa+ MCP: Streamable HTTP, <500ms, add-on OAuth 2.1 + PKCE S256, resource param, `/.well-known/oauth-authorization-server`, 401 without `WWW-Authenticate` | verified | developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart |
| Design guide: one intent per tool; avoid overlapping tools; cannot script Alexa speech; `structuredContent` reaches the model and voice layer | verified | developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-tools-schema-data-design.html |
| v1.0 design-guide quotes ("one decision per turn", structured-errors sentence) | unverified | not located in retrieved pages |
| Alexa Together: paid subscription; no longer available (May 21, 2025 update); Emergency Assist replacement | verified | aboutamazon.com (Alexa Together pages) |
| 81.4% (307 patients) reconciliation error or misunderstanding | verified | pmc.ncbi.nlm.nih.gov/articles/PMC3475816 (Ziaeian, JGIM 2012) |
| 73.7% discrepancies, 50.6% errors in 6,115 reconciliations | verified | doaj.org/article/3aba57c7feaf4fffa991ada53663c3c5 (*Applied Sciences* 2021) |
| 30-day inpatient admission 6.4% vs 14.7% (OR 2.54), pharmacist telephone reconciliation | verified (observational) | journalclub.wustl.edu summary of Liu et al., J Aging Health 2018 |
| "22.2% → 16.0%" | **removed** | 29-patient COPD pilot, *Annals of Pharmacotherapy* 2014 (digitalcommons.uri.edu/php_facpubs/1314); not the journal v1.0 cited |
| "~90% have a management deficiency (MDPI 2021)"; "52.7% (Age & Ageing 2010)"; "¼ preventable (Swiss Med Wkly)"; "WellSky ~20 min" | **unverified, removed** | not located; re-add only with the source in hand |
| Shared-list / per-person dose-log / missed-dose-alert features in consumer apps | verified (vendor-authored) | mwm.ai Uncle's Pills listing; caringvillage.com comparison pages |
| NSAIDs generally avoided in CKD | inference | standard guidance; the product enforces a sourced plan constraint instead |
| MCP `structuredContent` + text-block compatibility; `isError` for tool failures | inference | spec recall; verify against the 2025-11-25 spec text |

## Appendix D — v1.2 implementation addendum (20 Oct 2026)
Three additive changes surfaced during the build. Scope and the v1.1 tool intents are unchanged;
this records what the running system now does.

| # | Change | Why |
|---|---|---|
| 1 | Added a ninth tool, `resolve_request` (`approve` / `decline`) | §6.4 opened a pending request on refusal but §8 gave no tool to settle it. Refusals remain successful results; below `full`, resolving is refused and writes nothing |
| 2 | Added an eighteenth event type, `authority.change_declined` | A decline is a decision, not a refusal. Reusing `authority.change_refused` would overwrite the refusal that R5 audits |
| 3 | R5 closes when a request is approved *or* declined; `get_handoff` gains `pendingRequests`, and `settled` now requires an empty list | A settled request has answered the question R5 asks; the pending item needed a read path and a UI |

`check_dose` is also described in tool metadata as a **plan-consistency** check rather than a
safety verdict: it enforces the constraints recorded in the plan and does not recommend a dose.
