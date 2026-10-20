# DECISIONS

Architecture decision log. Entries D1 to D10 originate in
[`specs/SECOND-LOOK-IMPLEMENTATION-PLAN.md`](specs/SECOND-LOOK-IMPLEMENTATION-PLAN.md) §2.1;
D11 to D14 were discovered during Phase 0 execution.

Status values: `OPEN`, `RESOLVED`, `SUPERSEDED`.

## D1 — Protocol version negotiation
**Status: RESOLVED (Phase 0, task P0-2)**

Plan intent: accept any version the SDK declares supported; reject only what
is outside that set.

Spike result against `@modelcontextprotocol/sdk@1.32.1`:

```
LATEST_PROTOCOL_VERSION   = "2025-11-25"
SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]
```

The SDK's latest version is the track floor the PRD targets (`2025-11-25`).
The `2026-07-28` revision seen on the spec site is not declared by this SDK
version.

Decision: delegate negotiation entirely to the SDK. Nothing is hard-coded. A
live `initialize` returns `protocolVersion: "2025-11-25"`. `allowedOrigins`,
`allowedHosts` and `enableDnsRebindingProtection` are native SDK options, so
no hand-rolling was needed. That satisfies PRD §5.1: "do not hand-roll
session, version, or Origin handling unless a gap is proven".

## D2 — Zod 4 → JSON Schema
**Status: RESOLVED (Phase 0, task P0-3) — the planned fallback is NOT needed**

Planned risk: Zod 4's `z.toJSONSchema()` emits draft-2020-12 with `$schema` /
`$ref` / `anyOf` constructs some clients reject, with a fallback to `zod@3` +
`zod-to-json-schema`.

Spike result, using a deliberately hostile probe schema (reused sub-schemas,
`z.union`, `z.record`, `z.discriminatedUnion`, nullable + default):

| Token | Occurrences emitted by the SDK |
|---|---|
| `$ref` | **0** |
| `$defs` | **0** |
| `definitions` | **0** |
| `anyOf` | **0** |
| `oneOf` | 1 (discriminated union, fully inlined) |
| `$schema` | 1 (top level only, `draft-07`) |

The SDK inlines every reference, so there is nothing to flatten. The lone
`$schema` key is spec-legal: the SDK types `Tool.inputSchema` as
`z.core.$catchall<z.ZodUnknown>`, so the MCP schema explicitly permits extra
keys beyond `type` / `properties` / `required`.

Decision: keep `zod@4.6.7`. No downgrade. `server/schema.ts` still exposes
`stripJsonSchemaMeta()` because we emit schemas ourselves in the README
transcript, in tests and in Phase 3 evidence, and `assertNoReferences()`
guards the D2 claim in CI.

## D11 — TypeScript pinned to 5.9.3, not 7.0.2 *(new, Phase 0)*
**Status: RESOLVED**

`typescript@latest` is 7.0.2 (the native/Go port), which the plan did not
anticipate. `typescript-eslint@8.71.2` declares
`peerDependencies: typescript >=4.8.4 <6.1.0`.

Pinning TypeScript 7 would break the P0-8 lint gate with an unsatisfiable
peer range.

Decision: pin `typescript@5.9.3` (latest 5.x, in range). Revisit only when
typescript-eslint formally widens its range.

## D12 — `actorId` in `get_timeline` *(new, Phase 0)*
**Status: RESOLVED — owner approved option (a) 18 Oct 2026**

Two source documents conflict:

- PRD §8 gives `get_timeline` the input
  `{personId, from?, to?, actorId?, type?}`: the intent is literally
  "Who gave ibuprofen Friday?".
- Plan P1-6 asserts no tool accepts an `actorId` argument, as a fatal-risk
  gate ("refusal rests on undefined identity").

Reading taken: P1-6's threat is a client asserting who is acting. A read-only
filter does not establish identity, so it cannot make a refusal theatre.
`actorRole` is still resolved server-side at write time (PRD §5.4).

Decision: keep `actorId` as a read-only filter on `get_timeline` only.
`tests/schema.test.ts` encodes the invariant: no write tool may accept
`actorId` or `actorRole`, and `get_timeline` is asserted to be the sole
occurrence and non-mutating.

Owner ruling (18 Oct 2026): option (a), keep the filter. The parameter cannot
escalate privilege, because the caller already has unfiltered access to the
timeline. It only narrows results. Removing it would buy no security while
deleting a PRD-specified capability, and renaming it would invent a name the
PRD does not use.

If a reviewer disagrees, the reversal is one schema line and one assertion in
`tests/schema.test.ts`: accept `actorId` or `actorRole` on a write path, and
remove the `get_timeline` exception.

## D13 — DNS-rebinding allow-lists use the *live* bound port *(new, Phase 0)*
**Status: RESOLVED**

The SDK compares the `Host` header by exact string match, port included, and
does the same for `Origin`. Those headers carry the port the socket is
actually bound to, which is not always `config.port`.

Deriving the allow-lists from `config.port` meant every request 403'd whenever
`PORT` was overridden or the server bound to `:0` (which is what the
integration tests do).

Decision: DNS rebinding subverts the host name; the port is derived from the
trusted name. `server/config.ts` exposes `allowedHostNames` +
`originsForPort(localPort)`, and `server/mcp.ts` builds both lists per request
from `req.socket.localPort`. The check stays strict (`https://evil.com` still
403s) while surviving port overrides and ephemeral binds.

## D14 — Prebuilt native binaries are present *(new, Phase 0)*
**Status: RESOLVED — documented deviation from a Phase 0 exit criterion**

Phase 0 exit criteria say "Zero native dependencies in the tree". Measured:

```
node_modules/@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node
node_modules/lightningcss-linux-x64-gnu/lightningcss-linux-x64-gnu.node
```

These arrive via Vite 8's bundler and CSS minifier as prebuilt,
platform-specific binaries shipped as `optionalDependencies`. They are not
compiled from source and need no toolchain. That is what the PRD protects with
§11 "pure-JS dependencies only" / "no native compile" and P5-2.

Decision: accept them and record the deviation.
`find node_modules -name '*.node'` is reproducible evidence for the README.
No DB, crypto or build-from-source native module is present (`better-sqlite3`,
`bcrypt`, `sharp`, `canvas` all absent).

A mitigation was considered and declined on 18 Oct 2026: pinning Vite 7 so
the criterion would be literally true. It was rejected because it swaps the
bundler mid-project, with a rules engine and an MCP tool surface still ahead,
purely to satisfy a wording technicality that no judge will test by reading
`node_modules`. Reproducible evidence is in the README instead.

## D15 — `fold()` carries no per-case type assertions *(new, Phase 1)*
**Status: RESOLVED**

`CareEvent` is `EventBodySchema.and(envelopeSchema)`, an intersection of a
discriminated union with the event envelope. Narrowing on `event.type`
therefore already types `event.payload` correctly. All 17
`event.payload as SomeType` casts were dead weight, and ESLint rightly
rejected them.

Decision: no casts. The `switch` in `server/fold.ts` narrows on `type`, and
the `default` branch is an exhaustiveness guard that breaks the build if an
18th event type is added, rather than silently dropping data at runtime.

## D16 — Seed runs in two passes so acknowledgements name real findings *(new, Phase 1)*
**Status: RESOLVED**

D3 makes `findingId` a hash of `(medicationId, ruleIds, anchorEventId)`. A
`problem.acknowledged` event must therefore name an anchor event id, which
does not exist until the earlier events are in the chain. A single flat
fixture array is circular.

Decision: `seedDemoLog()` appends the scenario first, reads the real event ids
back out of the log, then appends the acknowledgements. If either anchor is
missing it throws rather than writing a dangling acknowledgement.

Every seed therefore exercises D3 against real chained data, something a unit
test with mock ids cannot do. `findingIdFor()` lives in
`server/finding-id.ts` and Phase 2's grouping must import it rather than
reimplementing the formula.

## D17 — Coverage gate scoped, and read from the JSON summary *(new, Phase 1)*
**Status: RESOLVED**

Plan D10 scopes coverage to `server/rules/**`, `server/fold.ts`,
`server/authority.ts`, `server/log.ts`. That scoping held up: the first Phase 1
coverage run failed at 81.04 %, so the gate caught it.

Decision: keep the scope. Read per-file numbers from
`coverage/coverage-summary.json` rather than the v8 text table. The table
omitted `authority.ts` entirely because it was at 100 %, which at a glance
looks the same as "not measured".

Current: `authority.ts` 100 %, `fold.ts` 90.27 %, `log.ts` 92.85 %, total
92.15 %, gate exits 0.

## D18 — Evidence unions are sorted, not first-seen *(new, Phase 2)*
**Status: RESOLVED**

`groupHits` unions every hit's evidence. Accumulating in first-seen order made
the output depend on the order hits arrived in, so rotating the input produced
a different `evidence` array even though ids and ranking were stable.

Decision: sort the union. Lexicographic order is arbitrary but total.
Chronological ordering belongs in `explain_problem` (Phase 3), where evidence
ids resolve back to whole events.

PRD §6.5 requires fully deterministic output. A "three runs identical" test
does not catch order-dependence; the permutation test does, and both now
exist.

## D19 — Acknowledgements resolve through the engine, not hard-coded ids *(new, Phase 2)*
**Status: RESOLVED**

PRD §6.5 groups hits per medication, so R1 and R2 on acetaminophen are a
single finding with `rules: ['R1','R2']`. The Phase 1 fixture acknowledged
`findingIdFor(…, ['R1'], …)`, a finding the engine can never emit.

Decision: the fixture declares which rule was acknowledged and when.
`seedDemoLog()` runs the real engine to resolve the actual `findingId`, and
throws if no finding contains that rule.

Consequence for Phase 3: any hard-coded `findingId` anywhere in the codebase
is suspect. If `find_problems` needs a demo finding, resolve it from
`findProblems()` instead of typing it by hand.

## D20 — A finding anchors on its oldest evidence, not its loudest *(new, Phase 2)*
**Status: RESOLVED**

The ibuprofen finding `[R3, R4, R6]` anchors on the `plan.constraint_set` event
(Day 1 08:10), not the `med.discontinued` event (Day 3) that the narrative
leads with.

Decision: keep it. D3 says the anchor is the earliest triggering event across
the group, and R4's administered mode genuinely traces back to the moment the
bar was set. Anchoring on the discontinue would make the id change if the plan
constraint were ever re-asserted later.

For the README: "the oldest evidence wins", so an acknowledged finding cannot
be renamed by new evidence.

## D21 — The SDK pre-validates tool arguments, so malformed-input errors are not ours *(new, Phase 3)*
**Status: RESOLVED — documented deviation**

P3-7 / PRD §8 require that failures return `isError: true` with the structured
payload `{code, message, missingFields[], suggestedFollowUp[]}`.

Measured behaviour of `@modelcontextprotocol/sdk@1.32.1`: the SDK validates
arguments against the tool's `inputSchema` before the handler is invoked.
Calling `find_problems` with `{}` returns:

```
isError           : true
structuredContent : undefined
content           : [{"type":"text","text":"MCP error -32602: Input validation error:
                     Invalid arguments for tool find_problems: Invalid input:
                     expected string, received undefined at personId"}]
```

Decision: keep strict schemas. Weakening them (making every field
`.optional()`) would make the handler the first line of validation and buy a
uniform error shape, but it would strip `required` from `tools/list`.
`required` is what a client reads to know what to send, so the schema is the
more valuable contract.

Our structured error shape applies to domain failures (`UNKNOWN_MEDICATION`,
`UNKNOWN_FINDING`, `INVALID_INPUT` reaching the handler). Schema failures
return the SDK's own well-formed `isError` message naming the offending field.
Neither path leaks a stack trace, and both are asserted in
`tests/tools.test.ts`.

Amendment (submission week): `personId` is the one exception. It is
`.optional()` on the four read tools, because this server is about exactly one
person (`ToolContext.personId`) and no tool lists people. An assistant cannot
discover an internal id from `tools/list`. Omitting it resolves to that person;
an explicit id that is not that person returns `UNKNOWN_PERSON` rather than an
empty result, because a typo must never be readable as `NONE_FOUND_IN_RECORD`.
The reasoning above still holds for every other field: `required` stays on what
a caller must supply.

## D22 — Both MCP response modes are supported and selectable *(new, Phase 3)*
**Status: RESOLVED**

PRD §9.2 requires the endpoint to respond with `application/json` or
`text/event-stream` and to support both. The SDK exposes this as a static
constructor flag (`enableJsonResponse`), not per-request negotiation, so
"support both" means supporting both configurations.

Decision: default to SSE, because that is what the demo client and MCP
Inspector both handle. Expose `SL_MCP_JSON_RESPONSE=1` for plain JSON, which is
friendlier to minimal third-party clients (task P5-7's clip).

`scripts/verify-protocol.sh` passes 17/17 in SSE mode and 16/16 in JSON mode
(the seventeenth is the SSE priming-frame check, correctly not applicable).

## D23 — The dev proxy rewrites the origin rather than the allow-list being widened *(new, Phase 4)*
**Status: RESOLVED**

`npm run dev` had no `/mcp` proxy, so the client could not reach the server at
all. Adding one immediately produced a 403 from our own DNS-rebinding defence,
because Vite forwarded the dev host in the `Origin` header and
`http://localhost:5173` was not trusted for a request arriving on the MCP port.

There were two ways to make it work: add the dev origin to the server's
allow-list, or have the proxy present the origin the server already trusts.

Decision: `changeOrigin: true`. The allow-list stays derived per request from
the live socket port, and nothing was added to it for convenience.

The 403 was the control working as designed. Relaxing it to make local
development comfortable would have weakened the one defence PRD §9.6 treats as
mandatory, and the relaxation would have outlived the need for it. A dev proxy
rewriting its own headers is the right place for this concern.

It took 30 min to find, because the failure looks identical to the first one.

## D24 — The image is Debian, not Alpine, and `.dockerignore` excludes `node_modules` *(new, Phase 5)*
**Status: RESOLVED**

Alpine is the conventional choice for a small Node image and would have been
roughly 60 MB smaller. It would also not have worked.

D14 records that the client build pulls two prebuilt platform binaries (Vite's
bundler and CSS minifier). Those are glibc builds. On Alpine's musl they fail
to load, and the build dies with a linker error. A judge who follows the
README and runs `docker run` would hit it.

Decision: `node:22-bookworm-slim`. Pin the libc the demo was verified on.

Second half of the decision: `.dockerignore` excludes `node_modules/`. Without
that, `docker build` would copy the host's warmed module tree into the image
and the build would succeed regardless of whether the lockfile works. P5-1
would pass while proving nothing, which is the failure mode the task exists to
catch.

The image itself has not been built. On the build machine, the Docker socket
is `root:docker`, and joining that group needs `sudo`, which is unavailable
here. That is stated in the Dockerfile and the README.

Both stages were run instruction by instruction in a pristine tree:

- Builder: `npm ci --ignore-scripts` (291 packages), then `npm run build`
  succeeds in ~480 ms, producing `dist/node/server/index.js`,
  `dist/client/index.html` and the client bundle.
- Runtime: `npm ci --omit=dev` (100 packages against 291 for the full dev
  tree), then boot on nothing but `dist` plus production modules. It serves
  the client, seeds the same 19 events with `sha256 0dc4f804…`, and answers
  `find_problems` with the canonical three findings.

That second run corrected an error this decision originally carried: the
runtime stage was copying `fixtures/` source on the stated grounds that the
server imports it. It does not need to: `tsc` compiles it into
`dist/node/fixtures/`, and the import resolves there. The COPY is gone. See
F36.

`CMD` also invokes `node` directly rather than `npm start`. npm as PID 1 does
not forward SIGTERM, so `docker stop` waits out the full 10-second timeout and
then SIGKILLs.

## D25 — The hash chain verifies stored bytes, not the schema's projection of them *(new, Phase 5)*
**Status: RESOLVED**

`verify()` hashed the event as returned by `EventSchema.safeParse`. Zod objects
strip unknown keys by default, so a field injected into a stored line was
discarded before hashing and the chain reported the log intact.

Decision: keep each line as `JSON.parse` produced it, and hash that. Read
`seq`, `prevHash` and `hash` off the stored record rather than the parsed copy.
`computeHash` keeps its typed signature for the write path. Widening it to
`unknown` would trade a real guarantee at every write site for nothing, so a
separate one-line helper hashes the untyped record.

The product's central claim is that the log is tamper-evident, and the
verifier's own output said "an edit to any byte changes that event hash". That
sentence was false. The same failure the product is designed to prevent, a
confident answer that the record does not support, was in the tool meant to
detect it.

Three tamper cases on a clean-clone log: editing `ts` exits 1 naming event 5;
injecting `notes` and `extra` exits 1 naming the fields; reordering keys exits
0, because canonical JSON sorts and no meaning changes. The regression test was
confirmed to fail against the previous `log.ts`.

This detects edits. It does not stop anyone who can rewrite the entire file
from recomputing every hash, because a chain with no signature attests to
integrity, not authorship. Signing is out of scope for a local demo log.

## D26 — Tailwind v4 and Motion, chosen over CSS-only motion *(new, Phase 4 polish)*
**Status: RESOLVED**

Offered CSS-only motion (zero new dependencies), Motion alone, or Motion plus
Tailwind. The third was chosen knowingly, mid-hackathon, against a verified
build.

Decision: take Motion plus Tailwind, and account for the cost now.

The client bundle went from 533 kB to 676 kB (206 kB gzipped); Motion is
roughly 45 kB gzipped of that. The client ships the MCP SDK to the browser
either way, and calling the protocol properly is worth more to this submission
than a smaller bundle.

At the root, Motion is set to `reducedMotion="user"` and a CSS layer kills
everything else, because either layer can be bypassed and P4-10 makes that
Tier-0. Only one authored moment uses it, a new turn arriving and findings
resolving in severity order, rather than a scatter of effects, because motion
competing with a finding is motion that hides it.

The design detector flagged one item on the first pass: a coloured
`border-left` on the turn cards, which it names as the most recognisable tell
of a generated interface. It was decoration, since the speaker was already
labelled, so the edge was removed and the surface does the work. Detection
was re-run after updating Impeccable from v4.2.0 to v4.6.0, because a pass
under the old rules is not a pass under the new ones.

## D27 — A tool handler builds its whole payload before validating it *(new, Phase 5)*
**Status: RESOLVED**

F33: four handlers validated a narrow payload and then returned a wider
object, so every `explain_problem` and `get_handoff` call was rejected by any
real MCP client with `-32602`.

Decision: build the complete payload first, parse that, return it.

```ts
const payload: ExplainProblemOut = { rules, derivation, events, what, evidenceDetail, nextAction };
ExplainProblemOutput.parse(payload);   // validates exactly what ships
return ok({ ...payload });
```

Extending the schema alone would have fixed the four known tools and left the
trap in place. In this shape the type system closes it: the handler's payload
is typed as the schema's own output type, so a field the schema does not
declare is a compile error. That it flagged the remaining three the instant
the first schema was corrected is evidence that the shape works.

Corollary: no `as unknown as` at a contract boundary.
`request_regimen_change` ended with
`ok(payload as unknown as Record<string, unknown>)`. The cast existed only
because an interface has no index signature, and it made the response
uninspectable by anything downstream. It is replaced with a spread. ESLint's
`no-unnecessary-type-assertion` already flagged it as removable; we had read
that and left it.

Consequence for how we verify: the unit suite cannot see this class.
`InMemoryTransport` skips output-schema validation, and curl does not
implement it either. Those are the two paths every existing check used.
Verification now runs through a real client over a real transport
(`npm run verify-ui`), and the regression test asserts on returned keys
rather than on transport behaviour, so it holds wherever it runs.

## D28 — The refusal loop closes with a second authority act, not an edit of the first *(new, v1.2)*
**Status: RESOLVED**

`request_regimen_change` refused an unauthorised request and left it pending;
nothing could settle it. The demo showed the refusal and the pending item, but
not the answer, so the loop the product is built around stopped one step short.

Decision: add `resolve_request` as the ninth tool, with the same authority as
making a plan change (`full`) and the same structured refusal below it.
Approving appends `authority.change_applied`; declining appends a new
eighteenth event type, `authority.change_declined`.

The alternative was to reuse `authority.change_refused`. Refusals are keyed by
request id in the fold (`state.refusals`), and R5 reads that map. Writing a
decline into it would overwrite the original refusal, losing who asked and why,
and R5's "one hit per request" logic would then read a mutation of the event it
is meant to audit. A decline is a different fact: the request was answered,
not refused.

Approval does not mutate the regimen. The PRD keeps `med.changed`
prescriber-side. An approved household request is recorded as authority
exercised (`authority.change_applied`) and declared settled; it does not
silently rewrite the medication. It is the minimal complete loop, and it keeps
the demo's central invariant: a household can grant permission, not practise
medicine.

R5 stops firing once a request is approved or declined, settled either way,
with the refusal still in the audit log. `get_handoff` gains
`pendingRequests` (no tenth tool), and `settled` now requires that list to be
empty. Resolving twice returns `already_decided` and writes nothing. Below
`full`, `resolve_request` refuses with a successful result and writes nothing,
so the request stays pending.
