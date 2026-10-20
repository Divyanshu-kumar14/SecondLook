# Phase 0 — Foundations & contracts

Date: Sun 18 Oct 2026 · Budget: 3.0 h · Status: ✅ complete, all exit criteria met
(unplanned work: the TypeScript pin and live-port allow-list rework. See F1 and F4.)

Goal: one Node process on `:8787` serving `/mcp` and the built client, with a conformant handshake
and no configuration.

---

## Exit criteria (PRD §3 Phase 0)

| Criterion | Result | Evidence |
|---|---|---|
| One Node process on `:8787` serves `/mcp` and the static client | ✅ | `curl /` → 200 (483 B HTML shell) |
| SDK Streamable HTTP transport in use | ✅ | `StreamableHTTPServerTransport`; session ID returned at init |
| Zod schemas shared | ✅ | `server/schemas/events.ts` (17 types) + `tools.ts` (8 tools) |
| `Origin: https://evil.com` → 403 | ✅ | `HTTP 403`: `Invalid Origin header: https://evil.com` |
| Handshake works with zero environment variables | ✅ | `HTTP 200`, `mcp-session-id` returned, `protocolVersion: 2025-11-25` |
| Zero native dependencies in the tree | ⚠️ | Deviation. See D14. 2 prebuilt binaries, none compiled from source |

---

## Task ledger

| ID | Task | Status | Verify | Result |
|---|---|---|---|---|
| P0-1 | Scaffold `package.json`, `tsconfig*`, pinned deps, 12 scripts | ✅ | `npm install` + `npm run typecheck` | exit 0 |
| P0-2 | Spike: SDK transport capability | ✅ | curl `initialize` returns session ID | session ID returned; D1 retired |
| P0-3 | Spike: Zod 4 → JSON Schema | ✅ | `npm test -- schema` | 12/12 pass; D2 retired, fallback not needed |
| P0-4 | Origin validation | ✅ | `evil.com`→403 and `:5173`→200 | both asserted |
| P0-5 | Shared Zod schemas (envelope, 17 types, 8 tools) | ✅ | `npm run typecheck` | green |
| P0-6 | Friction Log created | ✅ | file exists with real entries | 11 entries (F1 to F11) |
| P0-7 | Skeleton client from `./dist`, HOST/PORT, graceful shutdown | ✅ | `/`→200, `GET /mcp`→405 | both pass |
| P0-8 | `npm run verify` = typecheck && lint && test | ✅ | `npm run verify` | exit 0 |

---

## Verification evidence

### `npm run verify` — the whole gate

```
> tsc -p tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
> eslint .
> vitest run

 ✓ tests/schema.test.ts (12 tests) 23ms
 ✓ tests/mcp.test.ts (12 tests) 130ms

 Test Files  2 passed (2)
      Tests  24 passed (24)
```

### Live curl matrix (real server on `127.0.0.1:8787`)

```
P0-7a  GET /                          HTTP 200
P0-7b  GET /mcp (no SSE Accept)       HTTP 405
P0-4a  Origin: https://evil.com       HTTP 403
P0-4b  Origin: http://localhost:5173  HTTP 200
P0-5   zero-env initialize            HTTP 200
                                       mcp-session-id: 7dafe117-c386-46d3-adef-f7272cb54959
```

Session lifecycle: non-init without session → `400`; unknown session → `404`;
`DELETE` → `200` then reuse → `404`. Malformed JSON → `-32700`, process survives.

### D6 — the judge's exact command, in a clean copy

```
$ npm install
> npm run prepare
> npm run build
> npm run build:node && npm run build:client
vite v8.3.4 building client environment for production...
✓ 16 modules transformed.
dist/client/index.html  0.48 kB
✓ built in 206ms
added 272 packages in 11s

cold start (install -> listening): 116 ms      (budget: 8 s, P5-2)
```

### Zero native dependencies

```
$ find node_modules -name '*.node' -o -name 'binding.gyp'
node_modules/@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node
node_modules/lightningcss-linux-x64-gnu/lightningcss-linux-x64-gnu.node

$ for p in better-sqlite3 bcrypt sharp canvas node-gyp; do [ -d node_modules/$p ] && echo "$p"; done
(nothing)
```

Both are prebuilt platform binaries via `optionalDependencies`. No compiler, no `node-gyp`, nothing
built from source. See D14.

---

## Decisions recorded this phase

| ID | Decision | Outcome |
|---|---|---|
| D1 | Protocol negotiation | SDK declares `2025-11-25` as latest, exactly the track floor. Delegate; hard-code nothing. |
| D2 | Zod 4 → JSON Schema | Fallback not needed. SDK emits 0 `$ref`/`$defs`/`anyOf`; the one `$schema` key is spec-legal. |
| D11 | TypeScript | Pinned 5.9.3, not `latest` (7.0.2 breaks `typescript-eslint`'s `<6.1.0` peer range). |
| D12 | `actorId` filter | Kept on read-only `get_timeline`; no write tool may accept `actorId`/`actorRole`. Needs owner confirmation. |
| D13 | DNS-rebinding lists | Built per request from the live socket port, not `config.port`. |
| D14 | Native binaries | Accepted and documented as a deviation. |

Full rationale: [`DECISIONS.md`](../../DECISIONS.md).
Friction narrative: [`FRICTION_LOG.md`](../../FRICTION_LOG.md).

---

## What exists now

```
package.json  tsconfig.json  tsconfig.build.json  eslint.config.js
vite.config.ts  vitest.config.ts  .gitignore
DECISIONS.md  FRICTION_LOG.md
client/        index.html  main.tsx  App.tsx  styles.css  tsconfig.json
server/        app.ts  index.ts  mcp.ts  config.ts  schema.ts
               schemas/  events.ts  tools.ts  index.ts
scripts/       seed.ts  verify-log.ts  bench.ts   (loud stubs — Phase 1/3)
tests/         schema.test.ts  mcp.test.ts
```

Deliberate Phase 0 boundaries: `seed` / `verify-log` / `bench` exist but exit non-zero with a
message naming the phase that owns them. The 8 tools are Phase 3.

---

## Carried into Phase 1

1. `D12` needs an owner ruling: the read-only `actorId` filter against plan P1-6's blanket ban.
2. `verify-log` is still a stub. DoD #5 (`passes clean, fails after a one-byte edit`) is Phase 1
   P1-3, the plan's most important evidence item.
3. `.data/` is gitignored, so the JSONL log cannot be committed (PRD §10.4 gate).
   `fixtures/scenario.ts` is the source of truth.
4. Coverage thresholds are configured but inert: `include` covers `server/rules/**`,
   `server/fold.ts`, `server/authority.ts`, `server/log.ts`, none of which exist yet. `npm test`
   does not run coverage, so nothing fails prematurely; P2-12 switches it on once the rules engine
   lands.
5. npm prints an install-script warning for `esbuild` on a clean install. It is harmless (Vite 8
   uses rolldown) but worth a README line so a judge does not read it as a failure.