# Second Look — Phase-Wise Implementation Plan

> Source of truth: [`SECOND-LOOK-PRD.md`](./SECOND-LOOK-PRD.md) v1.1
> Plan version: v1.0 · Authored: Sun 18 Oct 2026
> Build freeze: Fri 23 Oct 2026, 18:00 IST (05:30 PDT) · Hard deadline: Sat 24 Oct 2026, 00:30 IST
> Submission window: Fri 23 Oct 15:00 to 18:00 IST is reserved for the Devpost form, collaborators, licence, and video upload. No feature work after 15:00 IST Fri.
> Rule: the when, the order, the verification command, and the cut line for every unit of work live in this file; the PRD holds the what.

## 1. How to use this plan

### 1.1 Status legend

| Mark | Meaning |
|---|---|
| ⬜ | Not started |
| 🟡 | In progress |
| ✅ | Done, with its `Verify` command run and the output captured |
| ⛔ | Cut (record the reason in the Friction Log) |
| 🧱 | Blocked (record the blocker inline) |

A task becomes ✅ only when the raw output of its `Verify` command is pasted into the PR description or the Friction Log. Reading the code does not count as verification.

### 1.2 Working rules

1. One commit per task ID: `feat(p2-3): implement R3 superseded-in-use with golden snapshot`.
2. Branch `work/<phase>-<slug>` off `main` and merge it as a passing unit. Never build on `main`.
3. Verify after every task that touches logic. Do not batch testing to the end.
4. The Friction Log is append-only and updated in the same commit as the friction appears.
5. Scope changes go through §11 (Change Protocol). A task added at hour 40 without a matching cut puts the freeze at risk.

### 1.3 Ownership

| Domain | Owner |
|---|---|
| `server/**`, `scripts/**` | `backend-specialist` |
| `client/**` | `frontend-specialist` |
| `tests/**`, coverage config | `test-engineer` |
| `fixtures/**`, seed determinism | `backend-specialist` + `test-engineer` review |
| `README.md`, submission artefacts | Orchestrator (docs are not a specialist domain) |
| Anything touching auth/identity/authority | `security-auditor` mandatory review before Phase 3 closes |

## 2. Preflight findings (verified 18 Oct 2026)

These were checked against the live environment before planning.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **F1** | Node v26.11.1, npm 12.2.1, Docker 29.9.1, 16 cores / 15 GB | `node -v`, `npm -v`, `docker --version` | The PRD's "Node ≥22" requirement is satisfied. Clean-container verification (DoD #1) can run locally. |
| **F2** | `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.7`, `vitest@5.0.5` are the current published versions; registry reachable | `npm view … version` | Pin these exactly in `package.json`. No `^` on Zod; see D2. |
| **F3** | The MCP spec site shows `2025-11-25` and states *"You are viewing an older version (2025-11-25)… View the latest version (**2026-07-28**)"* | `modelcontextprotocol.io/specification/2025-11-25` | Target `2025-11-25` (the track floor) and negotiate dynamically; do not hard-code a single accepted version. Confirm the exact supported set in P0-2. |
| **F4** | Repo contains only `LICENSE`, `README.md` (2 lines), `specs/`. No `package.json`, no code, one commit `6d3f2dd Initial commit` | `ls -la`, `git log` | Everything is Phase 0 work. No migration or blast-radius risk. |
| **F5** | `.git` is clean except untracked `specs/`; no `.opencode/` in repo | `git status --short` | The scaffold starts from a green field. |

### 2.1 Discrepancies found — resolved as decisions, not as surprises

| ID | PRD assumption | Reality | Decision |
|---|---|---|---|
| **D1** | Protocol version fixed at `2025-11-25`; absent → assume `2025-03-26`; invalid → 400 | A newer spec revision exists (F3) | Accept any version the SDK declares supported; reject only versions outside that set with 400. Log the negotiated version in the Protocol Inspector. Verified by curl in P3-6. |
| **D2** | "Zod → JSON Schema (one source of truth)" | Latest Zod is 4.x; Zod 4 has native `z.toJSONSchema()` emitting draft-2020-12 with `$schema`/`$ref`/`anyOf` constructs some clients reject | Pin `zod@4.6.7`. Build a single `toJsonSchema()` helper that strips `$schema` and flattens `$ref`. Spike in P0-3; if the SDK's schema plumbing fights it, fall back to `zod@3` + `zod-to-json-schema`. Decision recorded either way. |
| **D3** | `findingId` = hash of sorted evidence IDs (§6.5) | Append-only log ⇒ evidence set grows ⇒ findingId changes after any new dose ⇒ an acknowledged finding reappears as "new" mid-demo | `findingId` = hash of `(medicationId, sorted ruleIds, anchorEventId)` where `anchorEventId` is the earliest triggering event and is immutable. Acknowledgement keys on that stable ID. Covered by test P2-9. |
| **D4** | Demo runs live and writes refusals (§7, App. B #6) | Second and third demo takes see a mutated log → different `find_problems` output, duplicate pending requests | `npm start` truncates and re-seeds a byte-identical log on every boot (`SL_LOG_MODE=demo`, the default), so every judge run and every recording is identical. Provenance/persistence mode is retained behind a flag for tests. |
| **D5** | `Origin` validated on all connections (§9.6), the server's own DNS-rebinding defence | In dev the Vite server runs on `:5173` while the MCP server is on `:8787` → every dev request 403s | `allowedOrigins` includes `http://localhost:5173` and `http://127.0.0.1:5173` in dev only; in the built/static mode the client's own origin is same-origin. Test P0-4 asserts `https://evil.com` → 403 and `:5173` → 200. |
| **D6** | `npm start` cold start < 8 s serving `./dist` | If `dist/` is not built, `npm start` cannot serve the client, and a Vite build inside `start` blows the 8 s budget | Use an npm `prepare` script so the Vite build runs during `npm install`, not `npm start`. The judge command stays `npm install && npm start`. Measured and recorded in P5-2. |
| **D7** | 28 h estimate; video appears only in Appendix A | A polished ≤2:55 narrated video is 3 h of work that is unbudgeted | 3.0 h is carved out for P5-4, and a dry run is recorded Thu 22 Oct so Friday is not the first recording. |
| **D8** | "plan for 1.5× (≈42 h)" | Realistic productive capacity across 5 days at a sustainable pace is ≈34 h, not 42 h | Re-baselined to 31.25 h committed + 3.5 h contingency = 34.75 h planned against a 36 h ceiling (§3). The reduction comes from cutting client scope up front (§4 Tier table). |
| **D9** | "start the friction log on Oct 18" (rolling task) | No file, template, or owner existed, so the log was easy to lose on day one | Created as the first task of Phase 0 (P0-6), with a template and a per-phase commit reminder. |
| **D10** | "≥90 % lines on rules + authority" | An unscoped coverage gate fails on client glue and tool boilerplate and gets ignored | Coverage `include` set is exactly `server/rules/**`, `server/fold.ts`, `server/authority.ts`, `server/log.ts`, asserted in P5-3. |

## 3. Schedule and effort budget

### 3.1 Calendar

| Day | Window (IST) | Gross h | Phase | Commit gate |
|---|---|---|---|---|
| Sun 18 Oct | 15:30 to 23:00 | 6.0 | Phase 0: Foundations & contracts | `npm start` serves `/mcp` + client; handshake works with zero env vars |
| Mon 19 Oct | 09:30 to 20:00 | 9.0 | Phase 1 (AM): Log, fold, authority | Tamper test fails verification; identity resolves; refusal unit-tested |
| Mon 19 Oct | ″ | ″ | Phase 2a (PM): Rules R1 to R3 | R1 to R3 green with golden snapshots |
| Tue 20 Oct | 09:30 to 20:00 | 9.0 | Phase 2b: Rules R4 to R6, grouping, ranking | All of R1 to R6 fire on the fixture |
| Tue 20 Oct | ″ | ″ | Phase 3: MCP tool surface | 8 tools; p95 < 150 ms; curl + Inspector transcripts captured |
| Wed 21 Oct | 09:30 to 20:00 | 9.0 | Phase 4: Demo client | Full demo path runs end-to-end, unassisted |
| Wed 21 Oct EOD | — | — | Mini-challenge go/no-go (PRD §12.1) | Only if Phases 0 to 3 are green |
| Thu 22 Oct | 09:30 to 20:00 | 9.0 | Phase 5a: Hardening, README, evidence | Clean-container run green; README first 20 lines carry the judge command |
| Thu 22 Oct | ″ | ″ | Phase 5b: Video record (dry run + final) | ≤2:55 draft exists before Friday |
| Fri 23 Oct | 09:00 to 15:00 | 6.0 | Contingency only: fixes, not features | — |
| Fri 23 Oct | 15:00 to 18:00 | 3.0 | Submission admin | Form submitted, collaborators invited, licence verified |

Gross engineering is 48 h, committed work 31.25 h, contingency 3.5 h, and total planned 34.75 h against a 36 h ceiling. The rest goes to meals, context switches, and debugging.

### 3.2 Effort budget

| Phase | Budget h | Scope cut applied |
|---|---|---|
| Phase 0: Foundations & contracts | 3.0 | as PRD |
| Phase 1: Event log, fold, authority | 4.0 | as PRD |
| Phase 2: Rules engine | 5.0 | as PRD |
| Phase 3: MCP tool surface | 4.0 | as PRD |
| Phase 4: Demo client | 5.0 (PRD: 7.0) | 9 UI features → 5 Tier-0 + 2 Tier-1; mic/speech and audit-log view become Tier 2 |
| Phase 5a: Hardening, evidence, README | 4.0 | (PRD folds this into a shared 5 h with video) |
| Phase 5b: Video, clip, product feedback, friction log | 4.25 | 3.0 h of it is video, unbudgeted in the PRD (D7) |
| Submission admin | 2.0 | Fri 15:00 to 18:00 IST |
| Committed subtotal | 31.25 | |
| Contingency | 3.5 | Fri 09:00 to 15:00 IST is reserved for it |
| Total planned | 34.75 | ceiling 36 h |

## 4. Scope tiers and cut order

PRD §12.3 is authoritative, and it lists cuts in the order they hurt least as you go down. The tiers below make that order explicit, so a cut at hour 38 does not need a fresh judgement call.

| Tier | Contents | Rule |
|---|---|---|
| T0: never cut | MCP server on `/mcp` (conformant), 8 tools with schemas, R1 to R6, identity personas, refusal + audit + pending request, `check_dose`, `find_problems`, fixture + seed + `verify-log`, README with curl/Inspector evidence, demo video | Track-qualifying or the demo's spine |
| T1: cut last | Latency HUD · Protocol Inspector (static fallback) · evidence drawer · `get_handoff` with `settled:false` · third-party-client clip | Differentiators that survive a cut |
| T2: stretch | Browser mic-in/speech-out · S3 Object Lock audit anchor (`npm run anchor` / `npm run verify-anchor`) + AWS Builder mini · `care-reconcile` open-source mini · R7/R8 · deterministic utterance router beyond ~10 patterns | Claimed only if time is green. The planned Bedrock router was blocked by the trial account's zero on-demand quota (2026-10-21); the S3 anchor shipped instead. |
| T3: cut first | MCP Apps / `ui://` inline UI · R7 · R8 · Open Source mini · `get_handoff` · mic/speech + Bedrock · protocol inspector (degrade to a static handshake banner) | In the order listed |

`get_handoff` is both T1 and on the T3 cut list (PRD cut line 4). Build it last within Phase 4; if it goes, `settled:false` logic stays inside `find_problems` (PRD's own instruction).

## 5. Phase 0 — Foundations & contracts · Sun 18 Oct · 3.0 h

Goal: one Node process on `:8787` serving `/mcp` and the built client, with a conformant handshake at zero configuration.

Entry criteria: none (green field, F4).

| ID | Task | Files | Verify |
|---|---|---|---|
| **P0-1** | Scaffold: `package.json` (ESM, `type: module`, `engines.node ≥22`), pinned deps: `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.7`, `express@5`, `vitest@5.0.5`; scripts `start`/`dev`/`build`/`test`/`verify-log`/`seed`/`bench`/`verify`; `tsconfig.json` strict ESM; `prepare` → client build (D6) | `package.json`, `tsconfig.json` | `npm install` exits 0; `npm run typecheck` exits 0 |
| **P0-2** | Spike: SDK transport capability. Build a minimal `/mcp` with the SDK's Streamable HTTP transport. Determine which protocol versions it negotiates, and whether session ID, protocol-version rejection and DNS-rebinding/Origin protection are SDK options. Record findings in `specs/DECISIONS.md`. | `server/index.ts`, `specs/DECISIONS.md` | curl `initialize` returns a session ID (P0-5) |
| **P0-3** | Spike: Zod 4 → JSON Schema (D2). Prove `z.toJSONSchema()` produces an acceptable `inputSchema` for the SDK; prove the `$schema`/`$ref` stripper works; prove `outputSchema` validation round-trips. Fall back to `zod@3` + `zod-to-json-schema` if it fails. Decision recorded. | `server/schema.ts` | `npm test -- schema` green |
| **P0-4** | Origin validation config: reject `https://evil.com` → 403; allow the client origin and the Vite dev origin (D5). | `server/index.ts` | `curl -H 'Origin: https://evil.com'` → 403 and `Origin: http://localhost:5173` → 200 (both asserted) |
| **P0-5** | Shared Zod schemas module: event envelope, all 17 event types, the 8 tool `input`/`output` shapes. Single source of truth consumed by server, client and tests. | `server/schemas/*.ts` | `npm run typecheck` green |
| **P0-6** | Friction Log created (D9) with template + first entry. | `FRICTION_LOG.md` | File exists with ≥1 real entry |
| **P0-7** | Skeleton client served from `./dist`; `HOST`/`PORT` env overrides with `127.0.0.1` default; graceful shutdown. | `client/`, `server/index.ts` | `npm start` → `curl :8787/` 200, `curl :8787/mcp` 405 on GET-without-SSE |
| **P0-8** | `npm run verify` = `typecheck && lint && test`. ESLint flat config. | `.eslintrc`/`eslint.config.js` | `npm run verify` exits 0 |

Exit criteria (PRD §3 Phase 0): one Node process on `:8787` serves `/mcp` and the static client; the SDK Streamable HTTP transport is in use; Zod schemas are shared; `Origin: https://evil.com` returns 403; the handshake works with zero environment variables; the tree has zero native dependencies.

## 6. Phase 1 — Event log, fold & authority · Mon 19 Oct AM · 4.0 h

Goal: a tamper-evident, append-only care record that folds deterministically, with server-resolved identity.

| ID | Task | Files | Verify |
|---|---|---|---|
| **P1-1** | Event envelope + hash chain: `sha256(prevHash + canonicalJson(rest))`; monotonic `seq`, gaps forbidden. Canonical JSON must be stable (sorted keys, no whitespace variance). | `server/log.ts` | `npm test -- log` |
| **P1-2** | Append-only writer: no UPDATE, no DELETE in the write API. Corrections are superseding events (`supersedes`). | `server/log.ts` | compile-time absence of update/delete + test asserting rejection |
| **P1-3** | `verify-log`: recompute chain; `npm run verify-log` passes clean and fails after a manual edit (DoD #5). | `scripts/verify-log.ts` | run on clean log → 0; edit one byte → non-zero |
| **P1-4** | `fold()`: events → `CareState`, every field carries `{value, eventId, actorId, ts, source}` (§6.6). Cached; invalidated on append. Cold fold on ~300 events < 25 ms. | `server/fold.ts` | perf assertion in test |
| **P1-5** | Identity: `Authorization: Bearer demo-priya|demo-tom|demo-elena` → caregiver → role. No token → `guest` (role `none`). Zero-config handshake still works (guest may call read tools). | `server/identity.ts` | `npm test -- identity` |
| **P1-6** | No tool accepts an `actorId` argument. Assert this structurally (a lint rule or a test that enumerates all 8 input schemas and fails on the key). `actorRole` resolved server-side at write time. | `server/mcp.ts` | negative test |
| **P1-7** | Authority: role → permission matrix; refusal logic. Refusals come back as successful results. | `server/authority.ts` | `npm test -- authority`, 100 % line coverage enforced (DoD §1.5) |
| **P1-8** | Formulary: static drug → class map, ~12 synthetic drugs; `NSAID` class present. No clinical knowledge beyond this. | `server/formulary.ts` | unit test |
| **P1-9** | Deterministic seed generator producing the §7 scenario, byte-identical every run; `SL_LOG_MODE=demo` truncates and re-seeds on boot (D4). | `fixtures/scenario.ts`, `scripts/seed.ts` | run seed twice → `sha256sum` identical |

Exit criteria: append-only JSONL with a hash chain; `fold()` deterministic with provenance on every field; the authority model at 100 % coverage; the tamper test fails verification.

## 7. Phase 2 — Rules engine · Mon PM – Tue AM · 5.0 h

Goal: R1 to R6 as pure functions, deterministic, grouped per medication, ranked, and all firing on the fixture.

Contract (every rule): input `(CareState, asOf)` → `RuleHit[]` where `RuleHit = {ruleId, severity, what, evidence: eventId[], who, when, nextAction}`. No `Date.now()`, no I/O, no randomness. `asOf` is injected.

| ID | Rule | Task notes | Verify |
|---|---|---|---|
| **P2-1** | Scaffold `server/rules/`: one module per rule, `index.ts` registry, shared types, test harness | `server/rules/*` | `npm test -- rules` |
| **P2-2** | R1 `DOSE_INTERVAL`: medium; high if the rolling-24 h total exceeds `maxDailyMg`. Tolerance default 30 min | `rules/r1.ts` | unit + golden snapshot |
| **P2-3** | R2 `DISPENSE_MISMATCH`: high. Dispensed dose or form differs from the active prescription (catches Day 7 650 mg ER vs 500 mg IR) | `rules/r2.ts` | unit + golden |
| **P2-4** | R3 `SUPERSEDED_IN_USE`: critical. A dose recorded after that medication's discontinue/supersede event | `rules/r3.ts` | unit + golden |
| **P2-5** | R4 `CLASS_BARRED_BY_PLAN`: latent (prescribed) = high; administered = critical. Two modes (PRD §0 #7) | `rules/r4.ts` | unit + golden, both modes |
| **P2-6** | R5 `UNAUTHORIZED_PLAN_CHANGE`: high. Fires on an existing `authority.change_refused` where requester role < `full`. Per request, not per attempt | `rules/r5.ts` | unit + golden |
| **P2-7** | R6 `UNAUTHORIZED_ADMINISTRATION`: medium. A dose recorded by an actor with role `none` | `rules/r6.ts` | unit + golden |
| **P2-8** | Grouping & ranking: group per medication (R5 per request); `findingId` per D3 (stable anchor, not evidence hash); `severity = max`; `evidence = union`. Rank: severity desc → distinct rules desc → most recent evidence ts desc → `ruleId` asc. Fully deterministic | `rules/group.ts` | ranking permutation test |
| **P2-9** | Acknowledgement: `problem.acknowledged` hides from "new", keeps in handoff as acknowledged, unresolved. Regression test for D3: acknowledge a finding, append a new dose, assert the finding does not reappear as new | `rules/group.ts` | the D3 test |
| **P2-10** | R7/R8 stretch: implement only if Phases 0 to 1 finished ahead of budget at Tue 09:30 | `rules/r7.ts`, `r8.ts` | or ⛔ cut with reason logged |
| **P2-11** | Fixture assertions: R1 to R6 all fire; the fixture yields exactly the §7 findings; 3 consecutive runs produce byte-identical output (DoD #3) | `tests/rules.fixture.test.ts` | `npm test` |
| **P2-12** | Coverage gate on the scoped include set (D10) | `vitest.config.ts` | `npm test` fails if < 90 % |

Exit criteria: R1 to R6 pure, unit and integration tested; grouping and ranking deterministic; the fixture fires all six.

## 8. Phase 3 — MCP tool surface · Tue 20 Oct · 4.0 h

Goal: 8 tools, one intent each, `outputSchema`-validated, fast, and protocol-conformant, with captured evidence.

| ID | Task | Files | Verify |
|---|---|---|---|
| **P3-1** | Tool registration scaffold + shared error shape `{code, message, missingFields[], suggestedFollowUp[]}`. No stack traces cross the wire. | `server/tools/_shared.ts` | unit |
| **P3-2** | `get_current_regimen` · `get_timeline`: read paths, simplest first | `server/tools/` | contract test |
| **P3-3** | `check_dose`: dry run, writes nothing; verdict `OK|CAUTION|DO_NOT_GIVE` + reasons + `nextAction` (J1) | `server/tools/check_dose.ts` | test asserts zero events written |
| **P3-4** | `find_problems`: headline tool; `assurance` is `NONE_FOUND_IN_RECORD` \| `FINDINGS_PRESENT`, never "all clear"; `coverage{scannedEvents, from, to, lastDoseAt, unloggedExpectedDoses}` | `server/tools/find_problems.ts` | DoD #7 test: empty-violation event set ⇒ `NONE_FOUND_IN_RECORD` + coverage |
| **P3-5** | `explain_problem` · `get_handoff`: handoff returns SBAR with `settled:false` whenever `unresolved` is non-empty | `server/tools/` | unit |
| **P3-6** | `record_dose` (accepts and flags, never refuses) · `request_regimen_change` (the only refusing tool; returns `status:'refused'` + `whoCan` + `pendingRequestId`, writes `authority.change_refused`, and leaves a pending request for Priya) | `server/tools/` | integration test asserting all three of: refused, logged, pending created (DoD #4) |
| **P3-7** | Every tool result carries `structuredContent` validated by `outputSchema` and the identical JSON in a `text` block. Failures return `isError:true` with the structured payload. A refusal is a successful result. | `server/mcp.ts` | contract test over all 8 |
| **P3-8** | Descriptions written as customer intents with example phrases; Alexa selects tools from them | `server/tools/*.ts` | review |
| **P3-9** | Protocol compliance sweep (PRD §9): verify each of items 1 to 9 against the running server; hand-roll only what the SDK fails (§5.1 of PRD). Confirm D1 (dynamic version negotiation). | `server/index.ts`, `specs/DECISIONS.md` | `npm run verify-protocol` |
| **P3-10** | Evidence capture: scripted curl transcript `initialize` → `tools/list` → one `tools/call`, emitted as a paste-ready fenced block | `scripts/transcript.sh` | output reviewed |
| **P3-11** | MCP Inspector session recorded for all 8 tools | — | Inspector log saved |
| **P3-12** | Bench: p95 server time < 150 ms overall; `find_problems` on 500 events < 50 ms; print p50/p95 | `scripts/bench.ts` | `npm run bench` output pasted |

Exit criteria: 8 tools with `outputSchema`; structured results and structured errors; p95 < 150 ms; curl and Inspector transcripts saved; Origin 403, session honoured, protocol version negotiated.

## 9. Phase 4 — Demo client · Wed 21 Oct · 5.0 h (trimmed)

Goal: a client where the demo spine works unassisted: Priya asks for a second look, Tom is refused, Tom asks about ibuprofen.

The PRD over-estimates this phase. Nine UI features in 7 h is the likeliest cause of a missed freeze, so scope is cut to five Tier-0 features plus two Tier-1. Everything else is deferred to §4 and reinstated only on green.

| ID | Task | Tier | Files | Verify |
|---|---|---|---|---|
| **P4-1** | Persona switcher: sets the `Authorization` header per request. Shows who is speaking and what role that carries. | T0 | `client/` | switching changes the server's resolved actor |
| **P4-2** | Deterministic utterance router: ~10 patterns → tools. Labelled "Simulated NLU" in the UI. Typed input always works; the router never blocks it. | T0 | `client/router.ts` | every pattern maps to a real tool |
| **P4-3** | Phrasing layer: `client/phrase.ts` maps typed records → sentences by `ruleId` + `nextAction`. Deterministic templates, labelled "Simulated Alexa phrasing — Alexa+ generates its own." Finding spoken ≤ 25 words. | T0 | `client/phrase.ts` | snapshot test on fixture output |
| **P4-4** | Findings view + evidence drawer: one finding per turn; `aria-expanded` drawer listing evidence event IDs; provenance shown as *"recorded by Tom, from the discharge paper"* (the actor is listed as provenance; the record makes no causal claim) | T0 | `client/components/*` | keyboard-only walkthrough |
| **P4-5** | Transcript: real, screen-reader-labelled text, not a canvas | T0 | `client/` | screen-reader pass |
| **P4-6** | Latency HUD: server time per call | T1 | `client/` | visible and accurate |
| **P4-7** | Protocol Inspector: live `initialize` → `tools/list` over the wire, negotiated version, session ID | T1 (static fallback on T3 cut) | `client/inspector.tsx` | handshake visible |
| **P4-8** | Audit log view: `get_timeline` filtered to `authority.*`; the refusal entry appears live | T2 | `client/` | or ⛔ |
| **P4-9** | `get_handoff` panel: SBAR, `settled:false`, 3 unresolved | T2 (last thing built) | `client/` | or ⛔ |
| **P4-10** | A11y + motion: WCAG 2.2 AA (4.5:1), keyboard-complete, `prefers-reduced-motion` honoured | T0 | CSS + components | contrast + keyboard checklist |
| **P4-11** | Full demo dry run: the three-beat spine (second look → refusal → `check_dose`) plus J4 handoff, end to end, unassisted, recorded as a screencast for later | T0 | — | screencast file exists |

Exit criteria: persona switcher; transcript; phrasing layer; evidence drawer; the demo path runs end to end without touching storage directly (DoD #6).

## 10. Phase 5 — Hardening, evidence & submission · Thu 22 Oct – Fri 23 Oct

| ID | Task | Budget | Verify |
|---|---|---|---|
| **P5-1** | Clean-container run: `docker run` from a fresh clone, no environment variables, judge command only. This is DoD #1 and the PRD's top "fatal" risk. | 1.0 h | paste the container transcript |
| **P5-2** | Cold-start measurement: `npm start` → listening < 8 s, no native build (D6) | 0.5 h | `time npm start` output |
| **P5-3** | Coverage report: ≥ 90 % lines on the scoped set; 100 % on `server/authority.ts` | 0.5 h | `npm test -- --coverage` output |
| **P5-4** | README: judge command in the first 20 lines; synthetic-data and not-a-medical-device statements; what we simulate vs what Alexa+ would supply; why OAuth is out; the curl transcript; the Inspector session; the §9 protocol checklist; what a real add-on would need | 1.5 h | DoD #8 checklist, item by item |
| **P5-5** | Security review, mandatory before submit (`security-auditor`): identity/authority surface, no secrets, `.env.example` empty, JSONL gitignored, no client-supplied `actorId` reachable | 0.5 h | findings + resolutions |
| **P5-6** | Demo video: dry run Thu PM, final cut Thu night. Follow Appendix A beats; best material in the first 60 s; ≤ 2:55; English; public; no third-party trademarks or music (D7) | 3.0 h | duration check + upload |
| **P5-7** | Third-party client clip: same server called by MCP Inspector or another client (T1, cheap because Inspector is needed anyway) | 0.5 h | clip recorded, or ⛔ |
| **P5-8** | Product feedback, required submission artefact: for every tool/API/SDK used, what for, what worked, what needs work, onboarding, would you build again | 0.5 h | submitted |
| **P5-9** | Submission admin (Fri 15:00 to 18:00 IST): Devpost form; project description (what + how, and state what was built during the window); tracks entered; MIT licence verified; repo public; if private, invite all six collaborators the same day (invites expire in 7 days) | 2.0 h | submission confirmation |
| **P5-10** | Friction Log finalised and submitted (up to 10 % bonus) | 0.25 h | in submission |

## 11. Risk register and circuit breakers

| Risk | Class | Trigger | Response |
|---|---|---|---|
| Judges can't build or run it | fatal | any `npm install`/`npm start` failure in P5-1 | The container run is not deferred. If it fails, it displaces all T1/T2 work |
| Transport subtly non-conformant | fatal | any P3-9 item unverified | Hand-roll only what the SDK fails; keep the raw curl transcript current after every transport change |
| Demo reads as a scripted skin | fatal | video has no real language path | The phrasing layer and router are T0 and cannot be cut. If time is short, ship the third-party client clip instead of mic/speech |
| Refusal rests on undefined identity | fatal | any `actorId` reachable from a tool argument | P1-6 structural assertion is non-negotiable |
| Zod 4 / spec-version friction (D1, D2) | med | P0-2/P0-3 spikes fail | Decisions are pre-made fallbacks; record the outcome in `specs/DECISIONS.md` in the same hour, do not improvise at hour 30 |
| `findingId` instability (D3) | high | acknowledged finding reappears as new during the demo | P2-9 test gates the demo |
| Non-repeatable demo (D4) | high | second recording differs from the first | Truncate-on-seed; verified by running seed twice and comparing hashes |
| Scope creep past the budget (D8) | high | any task added without a matching cut | §11.2 protocol below |
| Schedule slip | high | any circuit breaker below trips | Cut lines §4, applied in order |
| Adoption blind spot: who enters the data? | impact | judges raise it | Name it in the video (Appendix A, 2:35): the roadmap is document/label intake with an LLM at the edge and human confirmation, with the deterministic core unchanged |
| Overclaiming evidence | med | any stat beyond §1.1 appears | Only §1.1 claims ship; Appendix C is the register |

### 11.1 Sprint circuit breakers (decided in advance, so nobody negotiates under pressure)

| Checkpoint | If not green by |
|---|---|
| All of R1 to R6 firing on the fixture | Tue 20 Oct 20:00 IST → cut R7/R8 (already T2); mini-challenge go/no-go defaults to no |
| 8 tools with schemas + transcripts captured | Tue 20 Oct 23:00 IST → cut `get_handoff`, `explain_problem` depth, all T1 client features |
| Demo spine runs unassisted | Wed 21 Oct 20:00 IST → drop to a two-beat demo (second look + refusal) and rewrite Appendix A accordingly |
| Clean-container run green | Thu 22 Oct 13:00 IST → all T2/T3 stay cut; no new features until green |
| Video draft exists | Thu 22 Oct 20:00 IST → record a minimal honest version Fri morning |

### 11.2 Change protocol

Any net-new task must be paid for by an equal-or-larger cut, written into this file, before work starts. A request in the Friction Log is not approval.

## 12. Verification matrix — PRD Appendix B mapped to tasks

| # | Definition of Done | Tasks | Evidence |
|---|---|---|---|
| 1 | `git clone && npm install && npm start` → client + `/mcp` on `:8787`, clean container, no env vars | P0-1, P0-7, P5-1, P5-2 | container transcript |
| 2 | Raw curl transcript + MCP Inspector session, all 8 tools, in README | P3-10, P3-11, P5-4 | README section |
| 3 | R1 to R6 fire on the fixture; unit-tested; identical output across 3 runs | P2-11 | test output |
| 4 | Every unauthorized plan change is refused and logged, and creates a pending request; integration test asserts all three | P3-6 | integration test |
| 5 | `npm run verify-log` passes clean and fails after a manual edit | P1-3 | two command outputs |
| 6 | The demo runs without touching storage directly | P4-11 | dry-run screencast |
| 7 | No-violation event set returns `NONE_FOUND_IN_RECORD` plus coverage | P3-4 | test output |
| 8 | README states synthetic data, not a medical device, what is simulated, why OAuth is out | P5-4 | README review |
| 9 | Product feedback + friction log submitted; collaborators/licence verified; submitted by Oct 23 18:00 IST | P0-6, P5-8, P5-9, P5-10 | submission confirmation |
| — | p95 < 150 ms server time; `find_problems` on 500 events < 50 ms | P3-12 | bench output |
| — | ≥ 90 % coverage on rules + authority; 100 % on authority | P1-7, P2-12, P5-3 | coverage report |
| — | Origin → 403, session ID honoured, protocol version negotiated | P0-4, P3-9 | `npm run verify-protocol` |
| — | WCAG 2.2 AA, keyboard-complete, reduced-motion | P4-10 | a11y checklist |
| — | Deterministic `findingId` survives append (D3) | P2-9 | regression test |
| — | Identical seed across runs (D4) | P1-9 | two `sha256sum` values |

## 13. Mini-challenge decision · go/no-go Wed 21 Oct EOD

A mini is additive to the track prize (one track + one mini per project). Decide only if Phases 0 to 3 are green.

| Mini | Effort | Decision rule | Effort if yes |
|---|---|---|---|
| AWS Builder | Shared with the product | Yes, shipped as the optional S3 Object Lock audit anchor (`npm run anchor` / `npm run verify-anchor`). Off by default, never touches `/mcp`, needs no credentials for the base demo. The planned `start:agent` Bedrock router was dropped on 2026-10-21: the trial account's on-demand quota was zero and not adjustable. | S3 anchor |
| Open Source | Separate repo | Yes only if ≥ 2 h slack after AWS Builder. Extract the pure rules engine + provenance fold into `care-reconcile` (MIT). An unmerged fork/PR to a public repo qualifies. | 1.5 h |

If the mini takes the demo client below Tier-0 completeness, drop the mini. A working demo matters more than the $5 K prize.

**Decision update 2026-10-21.** Bedrock could not be used on this account: the
trial plan sets the Nova on-demand quota to 0, marked not adjustable, and calls
returned `ThrottlingException: Too many tokens per day`. The AWS Builder
integration shipped as the S3 Object Lock audit anchor instead; the Bedrock
router remains a documented option, not a build claim.

## 14. Immediate next actions (Sun 18 Oct, in order)

1. Commit this plan.
2. `P0-1` scaffold `package.json` / `tsconfig.json` / scripts.
3. `P0-2` + `P0-3` spikes first; they retire D1 and D2 while there is still time to change course.
4. `P0-6` create the Friction Log and log the first two spikes as soon as they finish.
5. `P0-4` Origin config + `P0-5` shared schemas.
6. `P0-7` + `P0-8` client skeleton, `npm run verify` green → Phase 0 exit.

Two things to avoid: starting the client before the 8 tool contracts exist (it will be rebuilt against real schemas), and starting the video after Friday morning.
