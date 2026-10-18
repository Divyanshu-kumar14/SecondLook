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

```
$ npm run verify-log                       # clean
[verify-log] OK — 19 events, chain intact.          exit 0

$ sed -i '0,/"amountMg":500/s//"amountMg":900/' .data/events.jsonl
$ npm run verify-log
[verify-log] TAMPERED — chain breaks at event 14 of 19.
             reason: hash mismatch at event 14: expected 290867e8bd84…, got 948bff4b80ec…
                                                exit 1
```

Editing one field is detected and located. It is still editable on disk — the
chain makes tampering **detectable**, not impossible, and we do not claim
otherwise.

## Verifying it yourself

```bash
npm run verify      # typecheck + lint + tests + coverage gate
npm test            # 146 tests
npm test -- --coverage
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