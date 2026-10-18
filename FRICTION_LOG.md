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