# Second Look — Household Care Reconciliation for Alexa+

```bash
npm install && npm start
```

Then open **<http://127.0.0.1:8787>**. That is the whole setup. No environment
variables, no API keys, no database, no external services.

The same process serves the MCP endpoint at `POST|GET|DELETE /mcp` and the built
client. Check it is alive:

```bash
curl -s http://127.0.0.1:8787/healthz
npm run verify-log        # 0 = hash chain intact
```

---

> **This is not a medical device, and all data is synthetic.** Every person,
> medication and event is generated in code by `npm run seed`. Nothing here is
> clinical advice, and the system enforces constraints that arrive in the care
> record rather than deciding what is medically correct on its own.

---

## What it does

A household cares for someone with several medications, more than one carer, and
paperwork from a pharmacy and a hospital that never quite agree. When something
goes wrong, nobody can reconstruct what was actually given, by whom, and whether
it was safe to give.

Second Look keeps an **append-only, tamper-evident** record and answers three
questions honestly: *is this dose safe to give right now*, *are we doing this
right*, and *what still needs a human to resolve*.

It exposes that as **8 MCP tools**, each written as one customer intent, so an
assistant can select them from how a person actually speaks.

## Why the demo repeats exactly

A demo that changes between takes cannot be recorded twice. `npm start`
truncates and re-seeds a byte-identical log on every boot, so the first judge run
and the third recording see precisely the same state:

```
$ npm run seed && npm run seed && sha256sum
ec3e5598ed327b373b7c29ccdaa0d1862b0e4c20e0f8ba9afa06547fe45e4e67
ec3e5598ed327b373b7c29ccdaa0d1862b0e4c20e0f8ba9afa06547fe45e4e67
```

## The scenario

Robert Alvarez, 74, hip replacement, hypertension and CKD stage 3. NSAIDs are
barred by his plan. His discharge paperwork prescribes ibuprofen anyway. Three
days later a pharmacist's phone call — not the prescriber — stops it. On day five
it is given twice, once by a carer with no authority at all.

That yields **three unresolved problems**, and the engine finds all of them:

| Finding | Rules | Severity |
|---|---|---|
| Ibuprofen given after it was stopped — and the stop was never prescriber-confirmed | R3, R4, R6 | critical |
| Pharmacy dispensed 650 mg ER against a prescribed 500 mg IR; doses only 4 h apart | R1, R2 | high |
| A carer with role `none` asked to change the regimen | R5 | high |

## How it refuses, and how it does not

Recording a dose is **never blocked**. A real dose that happened must always be
loggable by anyone, so `record_dose` accepts and flags (R6) instead of refusing.

Only **plan changes** are refused, and a refusal is a **successful result**, not
an error — the caller renders it. That refusal is credible only because identity
is resolved server-side: no tool accepts an `actorId` that establishes who is
acting, and `actorRole` is stamped at write time from the bearer token. A
client-supplied actor would make every refusal theatre.

## What we simulate, and what a real add-on would need

**Simulated here.** Utterance routing and spoken phrasing are deterministic
templates, labelled as such in the UI. The server has no OAuth: identity is three
static, non-secret, deliberately-labelled demo personas, and an absent token
degrades to a guest. We deliberately publish **no** authorization-server
metadata, because advertising authentication we do not enforce misleads clients.

**A real Alexa+ add-on would need** OAuth 2.1 authorization-code with PKCE (S256),
the `resource` parameter set to the server's canonical URI, auth-server metadata
at `/.well-known/oauth-authorization-server`, a 401 carrying `WWW-Authenticate`
for unauthenticated requests, and a reachable remote URL with sub-500 ms round
trips.

**Out of scope for an MCP server:** the shared-speaker problem. If two people use
one Echo, the server cannot tell them apart. That is a voice-profile concern, not
something this protocol exposes — we say so rather than pretend to solve it.

## Integrity

The log is append-only and SHA-256 hash-chained. There is no update and no delete
in the write API; corrections are new superseding events.

Three tamper cases, all run against a log seeded by a clean clone:

```
$ npm run verify-log                                   # untouched
[verify-log] OK — 19 events, chain intact.              exit 0

$ # edit a field the schema knows
$ npm run verify-log
[verify-log] TAMPERED — chain breaks at event 5 of 19.
             reason: hash mismatch at event 5: expected b33f057e5fa4…, got f78a8fccf0dd…
                                                         exit 1

$ # inject fields the schema does not know
$ npm run verify-log
[verify-log] TAMPERED — chain breaks at event 5 of 19.
             reason: unexpected field(s) not in EventSchema: notes, extra —
                     the stored record is not the record that was hashed
                                                         exit 1

$ # reorder keys, change nothing else
$ npm run verify-log
[verify-log] OK — 19 events, chain intact.              exit 0
```

The second case is worth reading twice. It used to **pass**: `#load()` ran every
line through `EventSchema`, a Zod object, which strips unknown keys — so an
injected field was discarded before hashing and the chain never saw it. The
verifier now hashes what `JSON.parse` produced, not what the schema kept. That
was found by running the tamper check during P5-1 rather than assuming it had
been run before, and it is recorded as **F30** / **D25**.

Editing one field is detected and located. It is still editable on disk — the
chain makes tampering **detectable**, not impossible, and we do not claim
otherwise. It also does not stop anyone who can rewrite the whole file from
recomputing every hash: a chain with no signature attests to integrity, not to
authorship.

## Evidence

Everything below was produced by running the commands, on a clean clone of this
repository, with no environment variables set.

### Clean install and cold start

```
$ git clone <this repo> && cd SecondLook
$ npm install
added 290 packages in 8s

$ env -i npm start        # strips the entire environment
[second-look] listening on http://127.0.0.1:8787
[second-look]   MCP endpoint : POST|GET|DELETE http://127.0.0.1:8787/mcp
[second-look]   client       : http://127.0.0.1:8787/
[second-look]   log mode     : demo — seeded 19 events, sha256 0dc4f804d7c5d9b0…
```

Cold start to listening: **0.58 s** against an 8 s budget. The seed hash is
identical on every machine, which is what makes the demo reproducible.

A production-only install — 100 packages against 290 for the full dev tree, the
same dependency set the Docker runtime stage uses — boots, seeds the same 19
events with the same hash, and answers `find_problems` with the same three
findings. No server module imports a dev dependency at runtime.

A `Dockerfile` is included. It is **Debian-based, not Alpine**: the client build
pulls two prebuilt glibc binaries, and Alpine's musl would fail to load them
(**D24**). The image was not built here — the build machine's Docker socket is
`root:docker` and adding the group needs `sudo`. What was verified is the part
that would actually fail: the clean-clone path and the production-only runtime,
both end to end.

### Protocol conformance (PRD §9)

```
$ npm run verify-protocol     # server must be running
  §9.1 initialize / initialized / session id           ✅
  §9.2 response mode: SSE and application/json         ✅
  §9.3 tools/list carries full JSON Schema             ✅
  §9.4 session id enforced on later requests           ✅
  §9.5 MCP-Protocol-Version negotiated; invalid → 400  ✅
  §9.6 Origin validated on every connection            ✅
  §9.7 binds 127.0.0.1 by default                      ✅
  §9.8 GET → 405, DELETE terminates the session         ✅
  §9.9 JSON-RPC over UTF-8, one message per response   ✅
──────────────────────────────────────────
  passed: 17   failed: 0
──────────────────────────────────────────
```

### Latency

```
$ npm run bench
  find_problems (rules only)        p50  0.06 ms   p95  0.13 ms   budget 150 ms   PASS
  find_problems (full tool path)    p50  0.10 ms   p95  0.19 ms   budget 150 ms   PASS
  check_dose (projects a dose)      p50  0.08 ms   p95  0.12 ms   budget 150 ms   PASS
  find_problems on 500 events       p50 16.41 ms   p95 22.11 ms   budget  50 ms   PASS
  cold fold on 500 events           p50  0.02 ms   p95  0.02 ms   budget  25 ms   PASS
```

### Supply chain

```
$ npm audit
found 0 vulnerabilities
```

## Verifying it yourself

```bash
npm run verify      # typecheck + lint + tests + coverage gate
npm test            # 205 tests across 13 files
npm test -- --coverage

npm start                        # then, in another shell:
npm run verify-protocol          # PRD §9 checklist, needs the server up
npm run verify-log               # hash chain, exits 1 if tampered
npm run bench                    # latency budgets
```

Coverage is scoped to the rules engine, the fold, the log and the authority
model — the four places where a defect would be a safety problem. Current:
**94.8 %** overall, **100 %** on `server/authority.ts` and on every rule.

### A note on dependencies

`find node_modules -name '*.node'` returns two files, from Vite's bundler and CSS
minifier. Both are **prebuilt platform binaries** shipped as optional
dependencies — nothing compiles from source and no toolchain is needed, which is
what matters for portability. We state it rather than claim a purity we do not
have.

## Design decisions and friction

Decisions are recorded with their reasoning, including the two the plan expected
to fail and did not: [`DECISIONS.md`](DECISIONS.md). What actually went wrong
during the build — a fixture that acknowledged a finding the engine could never
emit, hidden order-dependence in evidence sorting, and more — is in
[`FRICTION_LOG.md`](FRICTION_LOG.md).

Per-phase evidence lives in [`specs/advancements/`](specs/advancements/).

## Licence

MIT — see [`LICENSE`](LICENSE). 100 % synthetic data; no real patient information
is present in this repository.