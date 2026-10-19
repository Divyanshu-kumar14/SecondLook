# Friction Log

> Append-only. Updated **in the same commit** as the friction appears (plan §1.2 rule 4).
> Submission artefact (DoD #9), worth up to 10 % of the track score.

**Template for new entries**

```
### F<n> · <one-line title> · <phase/task> · <status>
**What happened.** …
**Why it happened.** …
**How we found it.** <tool output / command>
**What we changed.** …
**Cost.** <minutes>
**Would we do it differently.** …
```

---

## Phase 0 — Foundations & contracts (Sun 18 Oct 2026)

### F1 · TypeScript 7 is `latest`, and it breaks linting · P0-1/P0-8 · RESOLVED
**What happened.** `npm view typescript version` → `7.0.2`. Pinning it made the P0-8 lint
gate unsatisfiable, because `typescript-eslint` peers on `typescript >=4.8.4 <6.1.0`.
**Why it happened.** The plan pinned versions for every other dependency but said nothing
about TypeScript; TS 7 shipped after the plan was written.
**How we found it.** `npm view typescript-eslint peerDependencies` → `{"typescript": ">=4.8.4 <6.1.0"}`.
**What we changed.** Pinned `typescript@5.9.3`. Recorded as **D11**.
**Cost.** 5 min.
**Would we do it differently.** No — checking peer ranges before pinning is the right habit.

### F2 · The SDK mints the session ID during the *request*, not during `connect()` · P0-2 · RESOLVED
**What happened.** `initialize` returned a session ID, but the **next** call on that session
(`tools/list`) failed with `Internal error (-32603)`.
**Why it happened.** I stored the session from a module-scoped `currentTransport` handle and
cleared it immediately after `server.connect(transport)`. The SDK does **not** fire
`onsessioninitialized` during `connect()` — it mints the session while handling the
initialize *request*, which happens after the handle was already nulled. The session map
was populated with `transport: undefined`.
**How we found it.**
```
[mcp] unhandled transport error: TypeError: Cannot read properties of undefined (reading 'handleRequest')
    at handleMcpRequest (dist/node/server/mcp.js:60:38)
```
**What we changed.** Refactored into a `McpSessionManager` class and captured `server` and
`transport` in a per-request closure (`const transport = new StreamableHTTPServerTransport({ … })`),
which is safe because the callback runs after the binding is initialised.
**Cost.** 25 min.
**Would we do it differently.** Yes — trust nothing about SDK callback timing; read the
`.d.ts` docs string *and* the `.js` source before wiring closures.

### F3 · Unknown session ID returned 400 instead of 404 · P0-2 · RESOLVED
**What happened.** A request bearing an unrecognised `MCP-Session-Id` got `400 Bad Request`,
not `404 Session not found`.
**Why it happened.** I collapsed "no session header" and "session header we don't know" into
one branch. PRD §9.4 distinguishes them.
**How we found it.** curl with `mcp-session-id: not-a-real-session` → `HTTP 400`.
**What we changed.** Split the branches: present-but-unknown → 404; absent-and-not-init → 400.
Now asserted in `tests/mcp.test.ts` for both cases, and 404 is re-asserted after `DELETE`.
**Cost.** 5 min.
**Would we do it differently.** No.

### F4 · DNS-rebinding allow-lists were pinned to the configured port · P0-4 · RESOLVED
**What happened.** Every request 403'd whenever `PORT` was overridden or the server bound to
`:0` (i.e. all integration tests), even with a legitimate origin.
**Why it happened.** I built `allowedHosts` / `allowedOrigins` from `config.port`. The SDK
matches the `Host` and `Origin` headers **exactly, port included**, and those carry the port
the socket is *actually* bound to.
**How we found it.** 6 failing tests: `origin http://127.0.0.1:37405 should be allowed: expected 403 to be 200`.
**What we changed.** `allowedHostNames` + `originsForPort(localPort)`, resolved per request
from `req.socket.localPort`. Recorded as **D13**.
**Cost.** 15 min.
**Would we do it differently.** Yes — derive anything host-shaped from the live socket, never
from a config value that merely *usually* matches.

### F5 · "Zero native dependencies" is not literally true · P0-1 · RESOLVED (documented)
**What happened.** The Phase 0 exit criterion says zero native dependencies. `find node_modules
-name '*.node'` returns two.
**Why it happened.** Vite 8's bundler (rolldown) and CSS minifier (lightningcss) ship
**prebuilt** platform binaries as optional dependencies. Nothing compiles from source.
**How we found it.** The check above.
**What we changed.** Recorded as **D14** with reproducible evidence, rather than pretending.
The PRD's actual intent — no native *compile*, no toolchain — is satisfied.
**Cost.** 5 min to diagnose; the honest-reporting decision is the point.
**Would we do it differently.** Would flag the exit criterion's wording to the plan owner.

### F6 · Project root resolved two levels up instead of three · P0-7 · RESOLVED
**What happened.** `npm start` printed
`[startup] Client build not found at /…/dist/dist/client` and served nothing.
**Why it happened.** The compiled entry is `dist/node/server/index.js` — three levels below
the root, not two. Hard-coded `resolve(here, '..', '..')`.
**How we found it.** The fail-loud startup check, which is exactly why P0-7 required one.
**What we changed.** `findProjectRoot()` walks up to the nearest `package.json`, which is also
correct under `tsx` in dev (one level deep).
**Cost.** 5 min.
**Would we do it differently.** No — the fail-loud check earned its keep immediately.

### F7 · Root `tsconfig` swallowed the client and broke JSX · P0-1/P0-8 · RESOLVED
**What happened.** ~24 × `TS17004: Cannot use JSX unless the '--jsx' flag is provided`.
**Why it happened.** The root `tsconfig.json` listed `client/**/*` but has no `jsx` flag, so
it re-compiled the client without React-JSX and failed — meaning `npm run typecheck` never
even reached the dedicated client project.
**How we found it.** `npm run typecheck` output, then `tsc --showConfig` on the client project
to prove *its* config was correct and the root one was the problem.
**What we changed.** Removed `client/**/*` from the root `include`; `typecheck` is now
`tsc -p tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit`.
**Cost.** 10 min.
**Would we do it differently.** Yes — one TS project per compilation target from the start.

### F8 · Root cause #1 masking root cause #2 (parsing hygiene) · P0-8 · RESOLVED
**What happened.** `Client App.tsx ... error TS5097` alongside a confusing
`--jsx is not set` on the same import line.
**Why it happened.** Chasing the F7 error messages led me to read them as two independent
problems. They were one.
**How we found it.** Reading the pair of errors together instead of fixing the first in isolation.
**What we changed.** Same edit as F7.
**Cost.** folded into F7.
**Would we do it differently.** Yes — when two errors share a file, check whether one cause
explains both before editing twice.

### F9 · npm 12 blocks dependency install scripts by default · P0-1 · NOTED
**What happened.** Clean `npm install` warned:
`1 package had install scripts blocked because they are not covered by allowScripts: esbuild@0.28.2`.
**Why it happened.** npm 12 gates lifecycle scripts; esbuild's `postinstall` fetches its binary.
**How we found it.** Clean-copy install for the D6 check.
**What we changed.** Nothing — the build succeeded regardless, because Vite 8 uses rolldown,
not esbuild. Recorded because a judge running the judge command will see the same warning.
**Cost.** 0 min.
**Would we do it differently.** No. Worth a README line so it does not read as a failure.

### F10 · `tools/list` answers `-32601` in Phase 0 · P0-2 · EXPECTED
**What happened.** `tools/list` returned `Method not found`.
**Why it happened.** By design: `McpServer.setToolRequestHandlers()` is invoked **only** from
`registerTool()`, so with zero tools registered there is no handler. The 8 tools are Phase 3.
**How we found it.** Grepped `mcp.js` and confirmed line 694 is the sole call site.
**What we changed.** Nothing in production code. Proved the full loop instead with
`tests/mcp.test.ts`, which injects a probe tool via `createApp({ registerTools })` and asserts
`tools/list` → schema, `tools/call` → `structuredContent` + identical text block, and that the
emitted schema contains no `$ref`/`$defs` (regression guard for **D2**).
**Cost.** 20 min (worth it — it de-risks all of Phase 3).
**Would we do it differently.** No.

### F11 · npm 12 / pkill self-match wasted a cycle · tooling · NOTED
**What happened.** `pkill -f "dist/node/server/index.js"` killed my own shell
(`Killed by SIGTERM`), because the pattern appeared in the shell's own command line.
**How we found it.** Obvious in hindsight.
**What we changed.** Self-excluding pattern: `pkill -f "node .*index[.]js"`.
**Cost.** 2 min.
**Would we do it differently.** Yes — bracket one character of any `pkill -f` pattern.

---

## Phase 1 — Event log, fold & authority (Sun 18 Oct 2026)

### F12 · Coverage gate failed at 81 % on the first run · P1-4/P1-7 · RESOLVED
**What happened.** `npm test -- --coverage` failed: `Coverage for lines (81.04%) does not
meet global threshold (90%)`. `fold.ts` sat at 66.66 %.
**Why it happened.** The §7 fixture only produces 12 of the 17 event types. `caregiver.left`,
`caregiver.authority_changed`, `med.changed` and `dose.missed` had no coverage at all, and
none of the defensive "unknown id" branches were exercised.
**How we found it.** The coverage gate — which is exactly why plan D10 scoped `include` to
four paths instead of leaving it global, where it would have been ignored.
**What we changed.** Added 7 tests covering the four missing event types, `med.changed`
with and without `maxDailyMg`, and the defensive branches for unknown caregiver and unknown
medication. Coverage went 81.04 % → **92.15 %**.
**Cost.** 20 min.
**Would we do it differently.** No. A gate that is never red is a gate that means nothing.

### F13 · The coverage text reporter omits a 100 % file · tooling · NOTED
**What happened.** `server/authority.ts` never appeared in the coverage table, which reads
like the security-critical file is not being measured.
**Why it happened.** The v8 text reporter's table listed only `fold.ts` and `log.ts`.
**How we found it.** Reading `coverage/coverage-summary.json` instead of trusting the table.
**What we changed.** Nothing in code. **Verified `authority.ts` is at 100 % lines**, so
DoD §1.5 is genuinely met. Per-file checks are now read from the JSON summary.
**Cost.** 3 min.
**Would we do it differently.** Yes — confirm any coverage claim from the JSON summary,
never from a rendered table that may be truncated.

### F14 · 17 unnecessary type casts in `fold.ts` · P1-4 · RESOLVED
**What happened.** ESLint flagged 17 × `no-unnecessary-type-assertion` on
`event.payload as SomeType`.
**Why it happened.** I assumed the payloads were not discriminated-union members. They are:
`CareEvent` is an intersection of a discriminated union with the envelope, so narrowing on
`event.type` already types `event.payload`.
**How we found it.** `npm run lint`.
**What we changed.** Removed all 17 casts and the 8 now-unused type imports. Better code
than before — the compiler was already proving the narrowing.
**Cost.** 10 min.
**Would we do it differently.** Yes — try the narrowing before reaching for `as`.

### F15 · The fixture could not name the findings it acknowledges · P1-9 · RESOLVED
**What happened.** `problem.acknowledged` must carry a `findingId`, but that id hashes an
*anchor event id* — and anchor event ids do not exist until the earlier events are already
in the chain. A single flat fixture array is circular.
**Why it happened.** Not a defect: D3 makes `findingId` depend on real event ids precisely
so it stays stable as evidence grows.
**How we found it.** Designing the §7 scenario against the D3 formula.
**What we changed.** The seed runs in **two passes** — append the scenario, read back the
real refusal and first-acetaminophen-dose event ids, then append acknowledgements naming
those. The seed aborts loudly if either anchor is missing.
**Cost.** 15 min.
**Would we do it differently.** No. This proves D3 works against real data, not a mock.

### F16 · Test harness misread a working tamper check · P1-3 · NOTED
**What happened.** The harness printed "FAIL — tamper went undetected" immediately after
`verify-log` had correctly reported `TAMPERED — chain breaks at event 14`.
**Why it happened.** I read `${PIPESTATUS[0]}` after the pipeline had been clobbered by an
intervening command, so the captured code was empty rather than `1`.
**How we found it.** The tool's own output said TAMPERED; only my harness disagreed.
**What we changed.** Re-ran all three exit codes without a pipeline: clean → 0,
tampered → 1, empty → 2. DoD #5 is met.
**Cost.** 3 min.
**Would we do it differently.** Yes — capture `PIPESTATUS` immediately, or avoid the pipe.

### F17 · Seed and server boot could have drifted apart · P1-9/D4 · RESOLVED
**What happened.** `scripts/seed.ts` and the server boot path both need to produce the §7
log. Two implementations would be free to diverge, and the second judge run would silently
differ from the first.
**Why it happened.** The plan requires both `npm run seed` and boot-time re-seeding.
**How we found it.** Anticipated while writing the boot path, not after a bug.
**What we changed.** Extracted `seedDemoLog()` into `fixtures/seed.ts`; the script and
`server/index.ts` both call it. One source of truth, verified by identical sha256.
**Cost.** 10 min.
**Would we do it differently.** No.
---

## Phase 2 — Rules engine (Sun 18 Oct 2026)

### F18 · `fold()` was discarding exactly what R5 and R6 need · P2-6/P2-7 · RESOLVED
**What happened.** Before writing R5 I checked what `fold()` retained. It stored the
`authority.change_refused` and `dose.recorded` **payloads only** — no `eventId`. R5 must cite
the refusal as evidence, and R6 must read the role recorded on the event. Neither was available.
**Why it happened.** Phase 1 folded for provenance *display*; Phase 2 folds for *evidence*. The
first design had no `actorRole` on `Provenance` at all.
**How we found it.** Reading `fold.ts` against the rule contracts before writing the rules.
**What we changed.** Added `actorRole` to `Provenance`, and retained `{eventId, ts, source}`
alongside every refusal, change request, applied change, observation, document and missed dose.
**Cost.** 15 min.
**Would we do it differently.** No. Designing the consumer before the data shape is the whole
point — this was caught by reading, not by a bug.

### F19 · The fixture's hard-coded acknowledgement could never match · P2-9 · RESOLVED
**What happened.** PRD §6.5 groups hits **per medication**, so R1 and R2 on acetaminophen collapse
into ONE finding with `rules: ['R1','R2']`. But the Phase 1 fixture acknowledged
`findingIdFor('med-acetaminophen', ['R1'], …)` — a finding that the engine can never emit. The
acknowledgement would have been silently dead forever.
**Why it happened.** The fixture was written before grouping existed, and the two documents
disagreed about what a finding *is*.
**How we found it.** Running the engine against the seeded log: the R1 finding came back
`ack=false` despite an acknowledgement existing for it.
**What we changed.** The fixture now declares *which rule* was acknowledged and *when*;
`seedDemoLog` runs the real engine to resolve the actual `findingId`, and throws if no finding
contains that rule. An acknowledgement can no longer dangle.
**Cost.** 25 min.
**Would we do it differently.** No. This is the second time a cross-phase assumption has been
wrong; both times a test caught it rather than a demo.

### F20 · The permutation test found real non-determinism · P2-8 · RESOLVED
**What happened.** Rotating the rule-hit input produced a **different** findings array. The
`findingId`s and the ranking were stable, but the `evidence` arrays came out in a different
order.
**Why it happened.** `unionEvidence()` accumulated evidence in first-seen order, so its output
depended on the order hits happened to arrive in.
**How we found it.** The rotation test, which is the only reason it exists. A "3 runs are
identical" check would NOT have caught this — it re-ran the same path every time.
**What we changed.** The union is now sorted, which is a total order and therefore deterministic.
**Cost.** 10 min.
**Would we do it differently.** No. Determinism needed testing against *permutation*, not just
repetition. Repetition proves stability; permutation proves order-independence.

### F21 · Four "after asOf" tests were testing the wrong thing · P2-2..P2-7 · RESOLVED
**What happened.** Four tests asserting a rule ignores events after `asOf` failed. My fixtures put
the "future" event on Day 6 while `asOf` was Day 7 18:00 — so the event was *inside* the window.
**Why it happened.** I set the boundary events relative to the medication's timeline rather than
to the injected clock.
**How we found it.** Four failures at once, which made the shared cause obvious.
**What we changed.** Moved all four past the boundary (Day 7, after 18:00). The point of `asOf`
is that it is injected, so boundary tests must be stated relative to it.
**Cost.** 8 min.
**Would we do it differently.** Yes — write boundary fixtures from `asOf` backwards, not forwards
from Day 0.

### F22 · Two R1 tests encoded wrong arithmetic · P2-2 · RESOLVED
**What happened.** (a) A test asserted a 5 h gap does NOT fire against a 6 h interval with 30 min
tolerance — but 5 h is inside 5 h 30 min, so it fires. (b) The `maxDailyMg` escalation test put
its doses on Days 1–2 while `asOf` was Day 7, so they sat outside the rolling 24 h window and the
cap was never breached.
**Why it happened.** I reasoned about the interval without doing the subtraction, and about the
rolling window without checking where it opens.
**How we found it.** Both tests failed against the real engine rather than my mental model.
**Cost.** 8 min.
**Would we do it differently.** Yes — compute the boundary once and write it into the test name.

### F23 · Grouping anchors on the earliest evidence, which is not the obvious one · P2-8 · NOTED
**What happened.** The ibuprofen finding `[R3, R4, R6]` anchors on the **plan constraint** event
(Day 1, 08:10), not the discontinue (Day 3) that the rules narrative leads with.
**Why it happened.** D3 anchors on the earliest triggering event across the WHOLE group, and R4's
administered mode traces back to the moment the bar was set.
**How we found it.** A test asserting the wrong anchor failed and pointed at the real one.
**What we changed.** Kept the engine's behaviour — it is correct — and made the test assert the
reasoning as well as the value, so it cannot later pass for the wrong reason.
**Cost.** 5 min.
**Would we do it differently.** No, but it is worth a line in the README: the oldest evidence
wins, and that is a feature, not a bug.

---

## Phase 3 — MCP tool surface (Sun 18 Oct 2026)

### F24 · A placeholder event id leaked into customer-facing output · P3-3 · RESOLVED
**What happened.** `check_dose` answers with `reasons[].evidence`, and those arrays contained the
literal string `"hypothetical"` — the placeholder id of the projected dose.
**Why it happened.** The dry run projects a fake dose onto a copy of the events and runs the
real rules over it. The rules faithfully cite whatever evidence they were given, including the
phantom.
**How we found it.** Reading the live transcript from `scripts/transcript.sh`, not a test — the
tests passed, because nothing asserted the evidence was real.
**What we changed.** The projected dose is the SUBJECT of the question, not evidence for it, so
its id is stripped from every evidence array before the result is returned. Added two tests:
one asserts the placeholder never appears in the response, the other asserts every cited id is a
real event that exists in the log.
**Cost.** 10 min.
**Would we do it differently.** Yes — assert evidence resolvability from the start. "Every id I
return can be looked up" is a property, not an afterthought.

### F25 · The SDK answers before our handler ever runs · P3-7 · RESOLVED (documented)
**What happened.** `find_problems` with `{}` returned `isError: true` but **no
`structuredContent`**, so it did not match the PRD's required structured error shape. The test
asserting the structured shape failed.
**Why it happened.** The SDK validates against `inputSchema` before invoking the handler. Our
`INVALID_INPUT` branch is a backstop, not the first line of defence.
**How we found it.** A failing contract test, then a probe printing the exact SDK response.
**What we changed.** Kept strict schemas on purpose and recorded the trade as **D21**, with
both paths now asserted separately: schema failures are graceful and name the field; domain
failures carry the full structured payload.
**Cost.** 20 min.
**Would we do it differently.** Would confirm SDK callback ordering before designing the error
contract around it.

### F26 · Discriminated-union narrowing stops working through an alias · P3-2 · RESOLVED
**What happened.** `const p = event.payload` outside a `switch (event.type)` produced fourteen
`restrict-template-expressions` errors, because narrowing on `event.type` narrows the `event`
binding and not a copy of its property.
**Why it happened.** I hoisted the payload into a local for readability, which quietly discarded
the narrowing the envelope's type was giving me for free.
**How we found it.** ESLint, after the same rule had already caught seventeen dead casts in
Phase 2.
**What we changed.** Referenced `event.payload` inside each case branch. This is the same lesson
as Phase 2 F14, arriving again — which is a sign the rule is worth keeping strict.
**Cost.** 8 min.
**Would we do it differently.** Would not alias a discriminated member out of its discriminant.

### F27 · `import { EventType }` — a type imported as a value · P3-12 · RESOLVED
**What happened.** `scripts/bench.ts` threw `does not provide an export named 'EventType'` at
runtime, because the import was written as a value import for what is purely a type.
**Why it happened.** Autocomplete default.
**How we found it.** Running the benchmark.
**What we changed.** `import type`. Two further import errors followed from assuming the test
harness's helpers lived in the scenario module; the bench now defines its own scaffolding.
**Cost.** 5 min.
**Would we do it differently.** Would check where a helper is actually exported before importing it.

### F28 · The evidence drawer said "0 records" while every layer tested green · P4-4 · RESOLVED
**What happened.** With three findings on screen, each drawer offered to show its evidence and
then displayed nothing. The button label read "Show the 0 records behind this".
**Why it happened.** Findings and their evidence were fetched in separate tool calls and merged
in `App.tsx` by looking up `evidenceByFinding[finding.findingId]`. The keys were written from
one turn and read from another, so a finding whose evidence call had not yet resolved matched
nothing — and `items.length === 0` was indistinguishable from "not loaded yet" and from "load
failed".
**How we found it.** A human, clicking. No test caught it: the rules engine had its own tests,
the tools had their own tests, and the drawer had a test for rendering a populated list. The bug
was in the seam between them, which is exactly the seam nobody owns.
**What we changed.** Evidence now travels with the turn that produced the finding, and the drawer
has three distinct states — loading, loaded, failed — instead of collapsing "no evidence yet",
"no evidence" and "evidence failed" into one.
**Cost.** 45 min.
**Would we do it differently.** Would treat "empty" as a smell in a UI and ask what is missing,
rather than reading it as a legitimate state.

### F29 · `npm run dev` served no proxy, and adding one hit our own DNS-rebinding 403 · P4-T0 · RESOLVED
**What happened.** Two failures in one afternoon. First, Vite had no `/mcp` proxy at all, so the
client could not reach the server in dev. Second, once the proxy existed, every request came back
403 — the server was correctly refusing an `Origin` it did not trust, because the proxy forwarded
the dev host unchanged.
**Why it happened.** The dev server was never exercised against the real transport until the
client work began. And the 403 was the security control working exactly as designed: the
allow-list is derived per request from the live socket port, not from a configured port.
**How we found it.** Clicking through in dev.
**What we changed.** `changeOrigin: true` on the proxy, so the upstream sees the origin it
already trusts. Recorded as **D23**. The 403 was not weakened and the allow-list was not widened.
**Cost.** 30 min.
**Would we do it differently.** Would write the dev proxy in Phase 0, when the transport landed,
instead of discovering the gap when the UI needed it.

### F30 · `verify-log` blessed injected fields — the chain verified the schema, not the file · P1-3 · RESOLVED
**What happened.** Running the DoD #5 tamper check for real, rather than assuming it had been run
before, showed that editing a known field failed correctly (exit 1, event 5 named) but injecting
an unknown field — `notes`, `extra` — verified clean and exited 0.
**Why it happened.** `#load()` ran every line through `EventSchema.safeParse`. `EventSchema` is a
Zod object, and Zod **strips unknown keys** by default. `verify()` then hashed the *parsed*
event, so an injected key was discarded before hashing and the chain never saw it. The script's
own message — "an edit to any byte changes that event hash and every hash after it" — was false.
**How we found it.** Actually performing the tamper during P5-1. The three existing tamper tests
covered a payload byte, a deletion and a corrupt line; none of them added a field.
**What we changed.** Each line is now kept as `JSON.parse` produced it and that is what gets
hashed. Chain links are read from the stored record too. `verify()` names stray fields rather than
reporting only a hash mismatch. Three tests added, and the key one was confirmed to **fail
against the previous `log.ts`** before being confirmed to pass against the new one.
**Cost.** 50 min.
**Would we do it differently.** Would have written the test as "inject an unknown field" from the
start. Testing only edits to fields the schema already knows tests the schema's own guarantees,
not the file's.

### F31 · `npm run verify-protocol` was documented in the plan but did not exist · P3-9 · RESOLVED
**What happened.** Running the verification command the plan names for the §9 protocol checklist
produced no output at all — the script had never been added to `package.json`.
**Why it happened.** The script was written and run by path (`bash scripts/verify-protocol.sh`)
during P3-9, and the npm script was never added. The plan's verification matrix and P3-9 both
say `npm run verify-protocol`.
**How we found it.** P5-1, while gathering DoD evidence from a clean clone.
**What we changed.** Added the script to `package.json`. It stays out of `npm run verify` because
it needs a running server, which `verify` deliberately does not assume.
**Cost.** 5 min.
**Would we do it differently.** Would treat every command named in a verification matrix as an
artefact that has to exist, and check them in one pass at the end of each phase.

### F32 · The README claimed 146 tests when there were 202 · P5-4 · RESOLVED
**What happened.** Re-running the gate during P5-1 showed a stale count in the README's
verification section: `npm test # 146 tests`. The real number was 202 across 13 files.
**Why it happened.** The stat was accurate when written in Phase 2 and was never refreshed as
tests accumulated.
**How we found it.** Running the command and comparing its output to the number in the file —
which is the only way to check a stat.
**What we changed.** Updated to the live figure. Worth stating plainly: a stale number in the
submission's front door is the same class of error this project exists to catch, and it survived
four phases because nobody re-read the README against a running command.
**Cost.** 5 min.
**Would we do it differently.** Would treat any number in the README as generated, not typed.

### F33 · Four tools violated their own output schemas, and nothing could see it · P5/P3-7 · RESOLVED
**What happened.** Driving the built client through a real browser found that the **evidence drawer had never worked**. Not intermittently — every finding, every run, rendered "No records could be loaded". The handover panel never loaded. Demo beat 2, the refusal, rendered a raw protocol error instead of a refusal.
**Why it happened.** One pattern, four times over:
```
ExplainProblemOutput.parse(payload);                   // validates 3 fields
return ok({ ...payload, what, evidenceDetail, ... }); // ships 7
```
Every handler built a *narrow* payload, validated that, then returned a *wider* object. A real MCP client validates the whole response against `outputSchema`, and our schemas are strict (`additionalProperties: false`), so any undeclared field is a hard `-32602`. The server validated something the user never received.
**How we found it.** Playwright against the live server, during P5. Not a test, not a linter, not the protocol sweep — a browser.
**What we changed.** Build the complete payload *before* parsing, so `.parse()` validates what actually ships. Schemas extended for `explain_problem`, `get_handoff` (including a conditional `acknowledged` on nested items), `record_dose`, and `request_regimen_change`. The `ok(payload as unknown as Record<string, unknown>)` cast in `request_regimen_change` was removed — that cast is precisely what let the mismatch hide.
**Cost.** 2 h. This is the most consequential bug in the project and it shipped through four phases.
**Would we do it differently.** Would have asked, of every handler, *"does `.parse()` see exactly what `ok()` sends?"* The answer was no four times, and the question took ninety seconds.

### F34 · A `.trim()` ate a space in the spoken answer · P4-3 · RESOLVED
**What happened.** The spoken summary read `...check the label with the pharmacy.Seen, not fixed.` — no space after the full stop, at every acknowledgement.
**Why it happened.**
```
const ack = finding.acknowledged ? ' Seen, not fixed.' : '';  // leading space is load-bearing
const sentence = `...${action}.` + `${ack}`.trim();             // trim() deletes it
```
The `.trim()` was there to tidy the empty case, where it was a no-op, and it also removed the one character doing real work.
**How we found it.** Reading the rendered screenshot. The browser harness does not check wording, so this one was mine, not the tool's.
**What we changed.** Dropped the `.trim()`. The existing test asserted `toMatch(/Seen, not fixed/)` — a bare substring that passed with the bug present — and now asserts `/\. Seen, not fixed\.$/`, which fails against the old code.
**Cost.** 15 min.
**Would we do it differently.** Would not `.trim()` a fragment whose leading whitespace was deliberately written. And would not match a substring when the defect is an adjacent character.

### F35 · Our first regression test passed against the broken code · P5 · RESOLVED
**What happened.** The regression test for F33 passed on the *unfixed* server. It would have shipped a green suite guarding a green lie.
**Why it happened.** The test called each tool through the SDK `Client` over `InMemoryTransport` and expected no throw. That transport does not validate responses against `outputSchema` — the entire mechanism F33 relied on. The test exercised the one path where the bug is invisible.
**How we found it.** We ran it against the pre-fix code on purpose, having learned the lesson from the hash-chain fix. A test that cannot fail is not evidence.
**What we changed.** Rewrote it as a data-level assertion: call every tool, then compare the keys actually returned against the keys its declared schema lists. Transport-independent, so it holds on any transport. Confirmed to fail pre-fix and pass post-fix.
**Cost.** 20 min.
**Would we do it differently.** Would validate a new regression test against the broken code *before* trusting it, every time — not just the once we remembered to. Two separate regression tests in this project have now had to be redone for this same reason.

### F36 · We documented a runtime dependency that was never one · P5-1 · RESOLVED
**What happened.** The Dockerfile's runtime stage carried a `COPY fixtures ./fixtures`, commented with a confident claim: *"`fixtures/` is a RUNTIME dependency, not test data — dropping it would make 'no environment variables' false."* It was wrong. `tsc` compiles `fixtures/` into `dist/node/fixtures/`, the server imports `../fixtures/seed.js`, and that path resolves *inside dist*. The COPY shipped TypeScript source that is never loaded at runtime.
**Why it happened.** The claim was reasoned, not tested. "The server imports from `../fixtures/`" sounds like the directory must exist, and it does not follow that the *source* directory must ship when the *compiled* one already has. Plausible, specific, and unverified — which is worse than vague, because it reads like it was checked.
**How we found it.** Executing every instruction of the Dockerfile in order in a pristine tree. The runtime stage booted, served the client, and returned the canonical three findings from a tree containing nothing but `dist` plus production `node_modules` — with no `fixtures/` source anywhere.
**What we changed.** The COPY is removed and the comment replaced with the actual mechanism and the evidence for it. Also switched `CMD ["npm", "start"]` to `CMD ["node", "dist/node/server/index.js"]`, since npm as PID 1 does not forward SIGTERM — `docker stop` would have waited out the timeout and SIGKILLed, losing an unflushed log.
**Cost.** 30 min to find; the error had already reached a commit message and the Dockerfile comment.
**Would we do it differently.** Would have run the instructions instead of reasoning about them. A specific claim in a comment needs the same evidence as a specific claim in the README — and we hold the README to that standard and not the Dockerfile.

### F37 · The contrast claim was asserted, never computed — and one pair failed · P4/P5 · RESOLVED
**What happened.** The muted text token (`#7d7768` on warm paper) measured **4.06:1** against the WCAG AA floor of 4.5:1 for normal-size text, light theme; ~40 render sites across the app. Dark theme passed at 5.67:1.
**How we found it.** A new permanent harness check computing relative-luminance ratios from the theme's own variables, in both color schemes. Its first run reported impossible numbers (3.46:1 for near-black on near-white) — which exposed a parse bug in the checker itself, not only a defect in the UI. Both facts were then confirmed by hand before any token was touched.
**What we changed.** Light `ink-faint` darkened one step to `#6f6a5c` (4.92:1 measured); dark untouched. DESIGN.md synced. All eight pairs now live in the harness as a regression guard.
**Cost.** ~30 min, mostly the measurement.
**Would we do it differently.** "Looks fine on a good screen" is not an accessibility test — the number comes first, judgment second. And a checker that can lie must fail loudly on impossible values, because impossible numbers are information: they are how a broken meter announces itself.
