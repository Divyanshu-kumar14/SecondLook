# Friction Log

> Append-only. Updated in the same commit as the friction appears (plan §1.2 rule 4).
> Submission artefact (DoD #9), worth up to 10 % of the track score.

Template for new entries

```
### F<n> · <one-line title> · <phase/task> · <status>
**What happened.** …
**Why it happened.** …
**How we found it.** <tool output / command>
**What we changed.** …
**Cost.** <minutes>
**Would we do it differently.** …
```

## Phase 0 — Foundations & contracts (Sun 18 Oct 2026)

### F1 · TypeScript 7 is `latest`, and it breaks linting · P0-1/P0-8 · RESOLVED
`npm view typescript version` returned `7.0.2`, and pinning that version made
the P0-8 lint gate unsatisfiable: `typescript-eslint` peers on
`typescript >=4.8.4 <6.1.0`. The plan pinned versions for every other
dependency but said nothing about TypeScript, and TS 7 shipped after the plan
was written.
`npm view typescript-eslint peerDependencies` returned
`{"typescript": ">=4.8.4 <6.1.0"}`. I pinned `typescript@5.9.3` and recorded
it as D11. The fix took 5 min. Checking peer ranges before pinning is
the right habit, so I would not change the approach.

### F2 · The SDK mints the session ID during the *request*, not during `connect()` · P0-2 · RESOLVED
`initialize` returned a session ID, but the next call on that session,
`tools/list`, failed with `Internal error (-32603)`. I had stored the session
from a module-scoped `currentTransport` handle and cleared it immediately
after `server.connect(transport)`. The SDK does not fire `onsessioninitialized`
during `connect()`. It mints the session while handling the initialize
request, which happens after the handle was already null. The session map was
populated with `transport: undefined`.

```
[mcp] unhandled transport error: TypeError: Cannot read properties of undefined (reading 'handleRequest')
    at handleMcpRequest (dist/node/server/mcp.js:60:38)
```

The fix was to refactor into a `McpSessionManager` class and capture `server`
and `transport` in a per-request closure:
`const transport = new StreamableHTTPServerTransport({ … })`. The callback
runs after the binding is initialised, so the closure is safe. Cost 25 min.
I would read the `.d.ts` docs string and the `.js` source before wiring
closures next time; SDK callback timing is not something to assume.

### F3 · Unknown session ID returned 400 instead of 404 · P0-2 · RESOLVED
A request carrying an unrecognised `MCP-Session-Id` came back `400 Bad Request`
instead of `404 Session not found`. I had collapsed "no session header" and
"session header we don't know" into one branch, and PRD §9.4 separates them.
curl with `mcp-session-id: not-a-real-session` returned `HTTP 400`. The
branches are now split: present but unknown gets 404, absent and not
initialised gets 400. `tests/mcp.test.ts` asserts both, and re-asserts the 404
after `DELETE`. 5 min, and I would not do it differently.

### F4 · DNS-rebinding allow-lists were pinned to the configured port · P0-4 · RESOLVED
Every request returned 403 when `PORT` was overridden or the server bound to
`:0`, which covers all integration tests, even with a legitimate origin. I had
built `allowedHosts` / `allowedOrigins` from `config.port`. The SDK matches the
`Host` and `Origin` headers exactly, port included, and those carry the port
the socket is actually bound to. 6 tests failed with
`origin http://127.0.0.1:37405 should be allowed: expected 403 to be 200`.
The fix was `allowedHostNames` plus `originsForPort(localPort)`, resolved per
request from `req.socket.localPort`, recorded as D13. 15 min. I would derive
anything host-shaped from the live socket, since a config value that usually
matches is not enough.

### F5 · "Zero native dependencies" is not literally true · P0-1 · RESOLVED (documented)
The Phase 0 exit criterion says zero native dependencies. `find node_modules
-name '*.node'` returns two. Vite 8's bundler (rolldown) and CSS minifier
(lightningcss) ship prebuilt platform binaries as optional dependencies, so
nothing compiles from source. I recorded D14 with the reproducible evidence.
The PRD's intent, no native compile and no toolchain, is satisfied. 5 min to
diagnose. I would flag the exit criterion's wording to the plan owner.

### F6 · Project root resolved two levels up instead of three · P0-7 · RESOLVED
`npm start` printed
`[startup] Client build not found at /…/dist/dist/client` and served nothing.
The compiled entry is `dist/node/server/index.js`, three levels below the root
rather than two, but the code hard-coded `resolve(here, '..', '..')`. The
fail-loud startup check caught it on the first run, which is what P0-7 asked
for. `findProjectRoot()` now walks up to the nearest `package.json`, which
also holds under `tsx` in development, where the entry sits one level deep.
5 min, and no change to the approach.

### F7 · Root `tsconfig` swallowed the client and broke JSX · P0-1/P0-8 · RESOLVED
Typecheck produced about 24 repetitions of
`TS17004: Cannot use JSX unless the '--jsx' flag is provided`. The root
`tsconfig.json` listed `client/**/*` but had no `jsx` flag, so it recompiled
the client without React JSX and failed. That meant `npm run typecheck` never
reached the client project at all. Running `npm run typecheck` showed the
errors; `tsc --showConfig` on the client project then proved its config was
correct and the root one was the problem. I removed `client/**/*` from the
root `include`, and `typecheck` is now
`tsc -p tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit`.
10 min. I would use one TS project per compilation target from the start.

### F8 · Root cause #1 masking root cause #2 (parsing hygiene) · P0-8 · RESOLVED
`Client App.tsx ... error TS5097` appeared alongside a confusing
`--jsx is not set` on the same import line. Chasing the F7 messages, I read
them as two independent problems. Reading the pair together, rather than
fixing the first in isolation, showed they had one cause. The edit was
the same as F7, and the cost folded into F7. When two errors share a file, I
would check whether one cause explains both before editing twice.

### F9 · npm 12 blocks dependency install scripts by default · P0-1 · NOTED
A clean `npm install` warned:
`1 package had install scripts blocked because they are not covered by allowScripts: esbuild@0.28.2`.
npm 12 gates lifecycle scripts, and esbuild's `postinstall` fetches its
binary. I found it on the clean-copy install for the D6 check. The build
succeeded anyway because Vite 8 uses rolldown, not esbuild, so nothing changed
in the project. The warning stays in the log because a judge running the judge
command will see it. 0 min. I would add a README line so it does not read as
a failure.

### F10 · `tools/list` answers `-32601` in Phase 0 · P0-2 · EXPECTED
`tools/list` returned `Method not found`. That is by design:
`McpServer.setToolRequestHandlers()` is invoked only from `registerTool()`,
so with zero tools registered there is no handler. The 8 tools arrive in
Phase 3. I grepped `mcp.js` and confirmed line 694 is the sole call site.
Nothing changed in production code. I proved the full loop with
`tests/mcp.test.ts`, which injects a probe tool through
`createApp({ registerTools })` and asserts `tools/list` returns the schema,
`tools/call` returns `structuredContent` plus an identical text block, and the
emitted schema contains no `$ref`/`$defs` (the regression guard for D2). The
test took 20 min and de-risks all of Phase 3. No change to the approach.

### F11 · npm 12 / pkill self-match wasted a cycle · tooling · NOTED
`pkill -f "dist/node/server/index.js"` killed my own shell with
`Killed by SIGTERM`, because the pattern appeared in the shell's own command
line. The replacement is a self-excluding pattern,
`pkill -f "node .*index[.]js"`. 2 min. I would bracket one character of any
`pkill -f` pattern.

## Phase 1 — Event log, fold & authority (Sun 18 Oct 2026)

### F12 · Coverage gate failed at 81 % on the first run · P1-4/P1-7 · RESOLVED
`npm test -- --coverage` failed with
`Coverage for lines (81.04%) does not meet global threshold (90%)`, and
`fold.ts` sat at 66.66 %. The §7 fixture
produces only 12 of the 17 event types. `caregiver.left`,
`caregiver.authority_changed`, `med.changed` and `dose.missed` had no
coverage, and none of the defensive unknown-id branches were exercised. The
coverage gate caught it. D10 had scoped `include` to four paths instead of
leaving it global, where it would have been ignored. I added 7 tests for the
four missing event types, `med.changed` with and without `maxDailyMg`, and the
defensive branches for an unknown caregiver and an unknown medication.
Coverage went from 81.04 % to 92.15 %. 20 min, no change.

### F13 · The coverage text reporter omits a 100 % file · tooling · NOTED
`server/authority.ts` never appeared in the coverage table, which made it look
like the security-critical file was not being measured. The v8 text reporter
listed only `fold.ts` and `log.ts`. Reading `coverage/coverage-summary.json`
instead of trusting the table showed `authority.ts` at 100 % lines, so DoD
§1.5 is met. Nothing changed in code; per-file checks now come from the JSON
summary. 3 min. I would confirm coverage from the JSON summary, since a
rendered table may be truncated.

### F14 · 17 unnecessary type casts in `fold.ts` · P1-4 · RESOLVED
ESLint flagged 17 instances of `no-unnecessary-type-assertion` on
`event.payload as SomeType`. I had assumed the payloads were not
discriminated-union members. They are: `CareEvent` is an intersection of a
discriminated union with the envelope, so narrowing on `event.type` already
types `event.payload`. `npm run lint` found it. I removed all 17 casts and the
8 now-unused type imports. The compiler was already proving the narrowing.
10 min. I would try the narrowing before reaching for `as`.

### F15 · The fixture could not name the findings it acknowledges · P1-9 · RESOLVED
`problem.acknowledged` has to carry a `findingId`, but that id hashes an
anchor event id, and anchor event ids do not exist until the earlier events
are already in the chain. A single flat fixture array is circular. I hit it
while designing the §7 scenario against the D3 formula. D3 makes `findingId`
depend on real event ids so it stays stable as evidence grows, which is why
the seed runs in two passes: append the scenario, read back the real refusal
and first-acetaminophen-dose event ids, then append acknowledgements naming
those. It aborts loudly if either anchor is missing. 15 min. I would keep
the design; this tests D3 against real data instead of a mock.

### F16 · Test harness misread a working tamper check · P1-3 · NOTED
The harness printed "FAIL — tamper went undetected" right after `verify-log`
had correctly reported `TAMPERED — chain breaks at event 14`. I read
`${PIPESTATUS[0]}` after an intervening command had clobbered the pipeline,
so the captured code was empty instead of `1`. The tool's own output said
TAMPERED; only the harness disagreed. I re-ran all three exit codes without a
pipeline: clean gave 0, tampered gave 1, empty gave 2. DoD #5 is met. 3 min.
I would capture `PIPESTATUS` immediately, or avoid the pipe.

### F17 · Seed and server boot could have drifted apart · P1-9/D4 · RESOLVED
`scripts/seed.ts` and the server boot path both need to produce the §7 log.
Two implementations would be free to diverge, and the second judge run could
differ silently from the first. The plan requires both `npm run seed` and
boot-time re-seeding. I saw the risk while writing the boot path, not after a
bug. I extracted `seedDemoLog()` into `fixtures/seed.ts`; the script and
`server/index.ts` both call it, and identical sha256 output confirms they
match. 10 min, no change to the approach.

## Phase 2 — Rules engine (Sun 18 Oct 2026)

### F18 · `fold()` was discarding exactly what R5 and R6 need · P2-6/P2-7 · RESOLVED
Before writing R5 I checked what `fold()` retained. It stored the
`authority.change_refused` and `dose.recorded` payloads only, with no
`eventId`. R5 has to cite the refusal as evidence, and R6 has to read the role
recorded on the event. Neither was available. Phase 1 folded for provenance
display; Phase 2 folds for evidence. The first design had no `actorRole` on
`Provenance` at all. Reading `fold.ts` against the rule contracts before
writing the rules caught it. I added `actorRole` to `Provenance` and retained
`{eventId, ts, source}` alongside every refusal, change request, applied
change, observation, document and missed dose. 15 min. No change. Reading
the rule contracts surfaced it before any bug.

### F19 · The fixture's hard-coded acknowledgement could never match · P2-9 · RESOLVED
PRD §6.5 groups hits per medication, so R1 and R2 on acetaminophen collapse
into one finding with `rules: ['R1','R2']`. The Phase 1 fixture acknowledged
`findingIdFor('med-acetaminophen', ['R1'], …)`, a finding the engine can never
emit, so the acknowledgement would have been dead forever. The fixture was
written before grouping existed, and the two documents disagreed about what a
finding is. Running the engine against the seeded log showed the R1 finding
coming back `ack=false` despite the acknowledgement. The fixture now declares
which rule was acknowledged and when; `seedDemoLog` runs the real engine to
resolve the actual `findingId` and throws if no finding contains that rule. An
acknowledgement can no longer dangle. 25 min. No change. This was
the second cross-phase assumption that turned out wrong, and both times a test
caught the error before a demo did.

### F20 · The permutation test found real non-determinism · P2-8 · RESOLVED
Rotating the rule-hit input produced a different findings array. The
`findingId`s and the ranking were stable, but the `evidence` arrays came out
in a different order. `unionEvidence()` accumulated evidence in first-seen
order, so its output depended on the order the hits happened to arrive in.
The rotation test found it. A "3 runs are identical" check would not have,
because it re-ran the same path every time. The union is now sorted, which is
a total order and therefore deterministic. 10 min. No change. I would test
a permutation. Repetition runs the same path; permutation changes the input
order.

### F21 · Four "after asOf" tests were testing the wrong thing · P2-2..P2-7 · RESOLVED
Four tests asserting that a rule ignores events after `asOf` failed. My
fixtures put the "future" event on Day 6 while `asOf` was Day 7 18:00, so the
event was inside the window. I had set the boundary events relative to the
medication's timeline instead of the injected clock. Four failures at once
made the shared cause obvious. I moved all four past the boundary, to Day 7
after 18:00. `asOf` is injected, so boundary tests have to be stated relative
to it. 8 min. Next time I would write boundary fixtures from `asOf`
backwards, not forwards from Day 0.

### F22 · Two R1 tests encoded wrong arithmetic · P2-2 · RESOLVED
Two tests had bad arithmetic. The first asserted that a 5 h gap does not fire
against a 6 h interval with 30 min tolerance, but 5 h is inside 5 h 30 min,
so it fires. The second, the `maxDailyMg` escalation test, put its doses on
Days 1 and 2 while `asOf` was Day 7, so they sat outside the rolling 24 h
window and the cap was never breached. I had reasoned about the interval
without doing the subtraction, and about the rolling window without checking
where it opens. Both tests failed against the real engine rather than my
mental model. 8 min. I would compute the boundary once and write it into
the test name.

### F23 · Grouping anchors on the earliest evidence, which is not the obvious one · P2-8 · NOTED
The ibuprofen finding `[R3, R4, R6]` anchors on the plan constraint event
(Day 1, 08:10), not on the discontinue (Day 3) that the rules narrative leads
with. D3 anchors on the earliest triggering event across the whole group, and
R4's administered mode traces back to the moment the bar was set. A test
asserting the wrong anchor failed and pointed at the real one. I kept the
engine's behaviour, which is correct, and made the test assert the reasoning
as well as the value so it cannot later pass for the wrong reason. 5 min.
No change, but the README should say that the oldest evidence wins.

## Phase 3 — MCP tool surface (Sun 18 Oct 2026)

### F24 · A placeholder event id leaked into customer-facing output · P3-3 · RESOLVED
`check_dose` answers with `reasons[].evidence`, and those arrays contained
the literal string `"hypothetical"`, the placeholder id of the projected dose.
The dry run projects a fake dose onto a copy of the events and runs the real
rules over it, and the rules cite whatever evidence they are given, including
the phantom. I found it by reading the live transcript from
`scripts/transcript.sh`; the tests passed because nothing asserted the
evidence was real. The projected dose is the subject of the question, so
its id is now stripped from every evidence array before the result is
returned. Two tests were added: one asserts the placeholder never
appears in the response, the other asserts every cited id is a real event in
the log. 10 min. I would assert evidence resolvability from the start.

### F25 · The SDK answers before our handler ever runs · P3-7 · RESOLVED (documented)
`find_problems` with `{}` returned `isError: true` but no
`structuredContent`, so it did not match the PRD's required structured error
shape. The test asserting that shape failed. The SDK validates against
`inputSchema` before invoking the handler; our `INVALID_INPUT` branch is a
backstop, not the first line of defence. A failing contract test and then a
probe printing the exact SDK response showed this. I kept the strict schemas
and recorded the trade as D21, with both paths asserted separately: schema
failures are graceful and name the field, domain failures carry the full
structured payload. 20 min. I would confirm where the SDK validates
relative to the handler before designing an error contract around it.

### F26 · Discriminated-union narrowing stops working through an alias · P3-2 · RESOLVED
`const p = event.payload` outside a `switch (event.type)` produced fourteen
`restrict-template-expressions` errors. Narrowing on `event.type` narrows the
`event` binding, not a copy of its property. I had hoisted the payload into a
local for readability, which discarded the narrowing the envelope's type was
giving me for free. ESLint caught it, after the same rule had already caught
seventeen dead casts in Phase 2. I now reference `event.payload` inside each
case branch. This is the same lesson as Phase 2 F14, which is a reason to keep
the rule strict. 8 min. I would not alias a discriminated member out
of its discriminant.

### F27 · `import { EventType }` — a type imported as a value · P3-12 · RESOLVED
`scripts/bench.ts` threw `does not provide an export named 'EventType'` at
runtime, because the import was written as a value import for something that
is purely a type. Autocomplete chose it. Running the benchmark found it. The
fix was `import type`. Two further import errors followed from assuming the
test harness's helpers lived in the scenario module; the bench now defines
its own scaffolding. 5 min. I would check where a helper is actually
exported before importing it.

### F28 · The evidence drawer said "0 records" while every layer tested green · P4-4 · RESOLVED
With three findings on screen, each drawer offered to show its evidence and
then displayed nothing. The button label read "Show the 0 records behind
this". Findings and their evidence were fetched in separate tool calls and
merged in `App.tsx` by looking up
`evidenceByFinding[finding.findingId]`. The keys were written from one turn
and read from another, so a finding whose evidence call had not yet resolved
matched nothing, and `items.length === 0` was indistinguishable from "not
loaded yet" and from "load failed".

A human clicking found it. No test caught it: the rules engine had its own
tests, the tools had their own tests, and the drawer had a test for rendering
a populated list. The bug was in the seam between them. Evidence now travels
with the turn that produced the finding, and the drawer has three states,
loading, loaded and failed, instead of collapsing "no evidence yet", "no
evidence" and "evidence failed" into one. 45 min. I would treat
"empty" as a smell in a UI and ask what is missing.

### F29 · `npm run dev` served no proxy, and adding one hit our own DNS-rebinding 403 · P4-T0 · RESOLVED
Two failures in one afternoon. Vite had no `/mcp` proxy at all, so the client
could not reach the server in development. Once the proxy existed, every
request came back 403 because the server was refusing an `Origin` it did not
trust: the proxy forwarded the dev host unchanged. The dev server had never
been exercised against the real transport until the client work began. The 403
was the security control working as designed, since the allow-list is derived
per request from the live socket port, not from a configured port. Clicking
through in development found both. `changeOrigin: true` on the proxy makes the
upstream see the origin it already trusts, recorded as D23. The 403 was not
weakened and the allow-list was not widened. 30 min. I would write the
dev proxy in Phase 0, when the transport landed, instead of discovering the
gap when the UI needed it.

### F30 · `verify-log` blessed injected fields — the chain verified the schema, not the file · P1-3 · RESOLVED
I ran the DoD #5 tamper check for real, rather than assuming it had been run
before. Editing a known field failed correctly, with exit 1 and event 5
named. Injecting an unknown field, `notes` or `extra`, verified clean and
exited 0. `#load()` ran every line through `EventSchema.safeParse`.
`EventSchema` is a Zod object, and Zod strips unknown keys by default.
`verify()` then hashed the parsed event, so an injected key was discarded
before hashing and the chain never saw it. The script's own message, "an edit
to any byte changes that event hash and every hash after it", was false.

I found it while performing the tamper during P5-1. The three existing tamper
tests covered a payload byte, a deletion and a corrupt line; none added a
field. Each line is now kept as `JSON.parse` produced it, and that is what
gets hashed. Chain links are read from the stored record too. `verify()` names
stray fields instead of reporting only a hash mismatch. Three tests were
added, and the key one was confirmed to fail against the previous `log.ts`
before it passed against the new one. 50 min. I would have written the
test as "inject an unknown field" from the start. The old tests only covered
fields the schema knew, so they tested the schema's guarantees.

### F31 · `npm run verify-protocol` was documented in the plan but did not exist · P3-9 · RESOLVED
Running the command the plan names for the §9 checklist produced no output
at all. The script had never been added
to `package.json`. It was written and run by path,
`bash scripts/verify-protocol.sh`, during P3-9, and the npm script was never
added, even though the plan's verification matrix and P3-9 both name
`npm run verify-protocol`. I found it during P5-1, gathering DoD evidence from
a clean clone. The script is now in `package.json`. It stays out of
`npm run verify` because it needs a running server, which `verify`
deliberately does not assume. 5 min. I would treat every command named
in a verification matrix as an artefact that has to exist and check them in
one pass at the end of each phase.

### F32 · The README claimed 146 tests when there were 202 · P5-4 · RESOLVED
Re-running the gate during P5-1 showed a stale count in the README's
verification section: `npm test # 146 tests`. The real number was 202 across
13 files. The stat was accurate when written in Phase 2 and was never
refreshed as tests accumulated. Running the command and comparing its output
to the number in the file is the only way to check a stat, and that is how I
found it. The README now carries the real number. The number had survived
four phases because nobody re-read the README against a running command. 5
min. I would generate any number in the README rather than typing it.

### F33 · Four tools violated their own output schemas, and nothing could see it · P5/P3-7 · RESOLVED
Driving the built client through a real browser showed that the evidence
drawer had never worked. It did not fail intermittently: every finding, every
run, rendered "No records could be loaded". The handover panel never loaded.
Demo beat 2, the refusal, rendered a raw protocol error instead of a refusal.
The same pattern appeared in four handlers:

```
ExplainProblemOutput.parse(payload);                   // validates 3 fields
return ok({ ...payload, what, evidenceDetail, ... }); // ships 7
```

Each handler built a narrow payload, validated that, then returned a wider
object. A real MCP client validates the whole response against `outputSchema`,
and our schemas are strict (`additionalProperties: false`), so any undeclared
field is a hard `-32602`. The server was validating something the user never
received. Playwright against the live server during P5 found it. The tests,
the linter and the protocol sweep found nothing. The fix is to build the
complete payload before parsing, so `.parse()` validates what actually ships.
Schemas were extended for `explain_problem`, `get_handoff` (including a
conditional `acknowledged` on nested items), `record_dose` and
`request_regimen_change`.
The `ok(payload as unknown as Record<string, unknown>)` cast in
`request_regimen_change` is gone; that cast let the mismatch hide. 2 h,
and the bug had shipped through four phases. I would have asked every handler,
"does `.parse()` see exactly what `ok()` sends?" The answer was no four times,
and the question took ninety seconds.

### F34 · A `.trim()` ate a space in the spoken answer · P4-3 · RESOLVED
Every acknowledgement read
`...check the label with the pharmacy.Seen, not fixed.` with no space after
the full stop. The cause was a stray trim:

```
const ack = finding.acknowledged ? ' Seen, not fixed.' : '';  // leading space is load-bearing
const sentence = `...${action}.` + `${ack}`.trim();             // trim() deletes it
```

The `.trim()` was there to tidy the empty case, where it did nothing, and it
also removed the one character doing real work. I found it in the rendered
screenshot. The browser harness does not check wording, so this one was mine,
not the tool's. I dropped the `.trim()`. The existing test asserted
`toMatch(/Seen, not fixed/)`, a bare substring that passed with the bug
present, and now asserts `/\. Seen, not fixed\.$/`, which fails against the old
code. 15 min. I would not `.trim()` a fragment whose leading
whitespace was deliberate, and I would not match a substring when the defect
is an adjacent character.

### F35 · Our first regression test passed against the broken code · P5 · RESOLVED
Our regression test for F33 passed on the unfixed server, so the suite would
have been green with the bug still present. The test called each tool through
the SDK `Client` over `InMemoryTransport` and expected no throw. That
transport does not validate responses against `outputSchema`, the mechanism
F33 depended on, so the test exercised the one path where the bug is
invisible. I ran it against the pre-fix code on purpose, having learned from
the hash-chain fix. I rewrote it as a data-level assertion: call every tool,
then compare the keys actually returned against the keys its declared schema
lists. That is transport-independent and holds on any transport. It was
confirmed to fail pre-fix and pass post-fix. 20 min. I would validate
a new regression test against the broken code before trusting it, every time.
I remembered to do it here. Two regression tests in this project have now had
to be redone for this reason.

### F36 · We documented a runtime dependency that was never one · P5-1 · RESOLVED
`COPY fixtures ./fixtures` was in the Dockerfile's runtime stage, with a
comment claiming that `fixtures/` was a runtime dependency and that dropping
it would make "no environment variables" false. That was wrong. `tsc` compiles
`fixtures/` into `dist/node/fixtures/`, the server imports
`../fixtures/seed.js`, and that path resolves *inside dist*. The COPY shipped
TypeScript source that is never loaded at runtime. The claim was reasoned
rather than tested. "The server imports from `../fixtures/`" sounds like the
directory must exist, and it does not follow that the source directory must
ship when the compiled one is already there. It was plausible and specific,
and it read like it had been checked.

I executed every instruction of the Dockerfile in order in a pristine tree.
The runtime stage booted, served the client and returned the canonical three
findings from a tree containing only `dist` plus production `node_modules`,
with no `fixtures/` source anywhere. The COPY is removed and the comment now
describes the actual mechanism and the evidence. I also switched
`CMD ["npm", "start"]` to `CMD ["node", "dist/node/server/index.js"]`, because
npm as PID 1 does not forward SIGTERM; `docker stop` would have waited out the
timeout and SIGKILLed, losing an unflushed log. 30 min to find. The error
had already reached a commit message and the Dockerfile comment. I would run
the instructions instead of reasoning about them, and hold a comment to the
same standard as the README.

### F37 · The contrast claim was asserted, never computed — and one pair failed · P4/P5 · RESOLVED
`#7d7768`, the muted text token on warm paper, measured 4.06:1 against the
WCAG AA floor of 4.5:1 for normal-size text in the light theme, across about
40 render sites. Dark theme passed at 5.67:1. A new permanent harness check
computes relative-luminance ratios from the theme's own variables in both
color schemes. Its first run reported impossible numbers, 3.46:1 for
near-black on near-white, which exposed a parse bug in the checker as well as
a defect in the UI. I confirmed both by hand before touching any token. Light
`ink-faint` is one step darker at `#6f6a5c`, measured at 4.92:1; dark is
untouched. DESIGN.md is synced, and all eight pairs are in the harness as a
regression guard. ~30 min, mostly measurement. I would measure the ratio
before judging the result, and make the checker fail on impossible values:
a parse bug hides the defect it was written to find.
