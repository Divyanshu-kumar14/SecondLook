# Phase 1 — Event log, fold & authority

**Date:** Sun 18 Oct 2026 · **Budget:** 4.0 h · **Status:** ✅ complete, all 9 tasks delivered
(overran slightly: the coverage gate went red on the first run — see F12)

**Goal:** a tamper-evident, append-only, deterministically-foldable care record with
server-resolved identity.

---

## Exit criteria (PRD §3 Phase 1)

| Criterion | Result | Evidence |
|---|---|---|
| Append-only JSONL with hash chain | ✅ | `sha256(prevHash + canonicalJson(rest))`, `seq` gap-checked |
| `fold()` deterministic, provenance on every field | ✅ | byte-identical across runs; every field carries `{eventId, actorId, ts, source}` |
| Authority model, 100 % coverage | ✅ | `server/authority.ts` = **100 % lines** (DoD §1.5) |
| Tamper test fails verification | ✅ | DoD #5 — clean → 0, one-byte edit → 1, empty → 2 |

---

## Task ledger

| ID | Task | Status | Verify | Result |
|---|---|---|---|---|
| **P1-1** | Envelope + hash chain, stable canonical JSON | ✅ | `npm test -- log` | 15 tests pass |
| **P1-2** | Append-only writer — no UPDATE/DELETE | ✅ | structural + behavioural | no `update/delete/remove/patch/set/truncate` exists |
| **P1-3** | `verify-log` passes clean, fails after edit | ✅ | **DoD #5** | exit 0 / 1 / 2 |
| **P1-4** | `fold()` → `CareState` w/ provenance, cached | ✅ | perf assertion | **cold fold 301 events well under 25 ms** |
| **P1-5** | Identity: bearer token → caregiver → role | ✅ | `npm test -- identity` | 7 tests |
| **P1-6** | No tool accepts `actorId` | ✅ | negative test | front-loaded in Phase 0 |
| **P1-7** | Authority matrix + refusal, 100 % coverage | ✅ | `npm test -- authority` | 8 tests, **100 %** |
| **P1-8** | Formulary — drug → class, NSAID present | ✅ | unit test | 17 drugs, all 12 classes reachable |
| **P1-9** | Deterministic seed, truncate-and-reseed on boot | ✅ | seed twice → same sha256 | **D4 confirmed end-to-end** |

---

## Verification evidence

### DoD #5 — tamper detection (the plan's most load-bearing item)

```
$ npm run verify-log          # clean
[verify-log] OK — 19 events, chain intact.
exit=0

$ sed -i '0,/"amountMg":500/s//"amountMg":900/' .data/events.jsonl   # one field, one byte
$ npm run verify-log
[verify-log] TAMPERED — chain breaks at event 14 of 19.
             reason: hash mismatch at event 14: expected 290867e8bd84…, got 948bff4b80ec…
exit=1

$ : > .data/events.jsonl       # empty
$ npm run verify-log           → exit=2
```

### D4 — determinism, and boot-time re-seeding

```
$ npm run seed && npm run seed && sha256sum
run 1: ec3e5598ed327b373b7c29ccdaa0d1862b0e4c20e0f8ba9afa06547fe45e4e67
run 2: ec3e5598ed327b373b7c29ccdaa0d1862b0e4c20e0f8ba9afa06547fe45e4e67
PASS — byte-identical across runs
```

The **server boot** re-seeds through the same shared function, so a second judge run and a
second recording are identical to the first:

```
[second-look]   log mode     : demo — seeded 19 events, sha256 ec3e5598ed327b37…
```

### Coverage gate

```
server/authority.ts lines 100%     ← DoD §1.5
server/fold.ts      lines 90.27%
server/log.ts       lines 92.85%
TOTAL               lines 92.15%   (threshold 90)
coverage gate exit=0
```

First run **failed at 81.04 %** — see F12. The gate earned its keep.

### `npm run verify`

```
Test Files  8 passed (8)
     Tests  88 passed (88)      (was 24 after Phase 0)
```

---

## Design decisions this phase

| ID | Decision |
|---|---|
| **D15** | `fold()` uses discriminated-union narrowing, zero casts, plus a build-breaking exhaustiveness guard |
| **D16** | Seed runs in **two passes** so acknowledgements name real anchor event ids — D3 proven against real data every seed |
| **D17** | Coverage scope kept (D10); per-file numbers read from the JSON summary, not the text table |

---

## What exists now

```
server/log.ts          append-only JSONL, canonical JSON, hash chain, verify
server/fold.ts         CareState + provenance, FoldCache, exhaustiveness guard
server/identity.ts     Bearer token -> persona -> role, degrades to guest
server/authority.ts    role -> permission matrix, refusal-as-result
server/formulary.ts    17 synthetic drugs -> 12 classes
server/finding-id.ts   D3 stable findingId
fixtures/scenario.ts   the §7 scenario, two-pass
fixtures/seed.ts       shared seedDemoLog() used by script AND server boot
scripts/seed.ts        implemented (was a Phase 0 stub)
scripts/verify-log.ts  implemented (was a Phase 0 stub)
tests/                 log, fold, identity, authority, formulary, scenario
```

The §7 scenario is fully seeded: ibuprofen prescribed while NSAIDs are barred, discontinued
Day 3 on a pharmacist's call (not prescriber-confirmed), then **given twice on Day 5** — by
Tom (role `record`) and by Elena (role `none`). Acetaminophen 4 h apart on Day 6, and a
650 mg ER dispense against a prescribed 500 mg IR on Day 7. All six findings are latent in
the data for Phase 2 to find.

---

## Carried into Phase 2

1. **Rules must import `findingIdFor()` from `server/finding-id.ts`** — do not reimplement D3.
2. **The exhaustiveness guard in `fold.ts` is load-bearing.** Adding an 18th event type must
   be a compile error, not a silent data drop.
3. **R5 fires on the refusal already in the log.** Elena's Day 4 refusal is seeded and real.
4. **Coverage `include` now matches four live files.** Phase 2's `server/rules/**` joins it;
   P2-12 turns the gate on for the rules path and the threshold applies unchanged.
5. **`get_timeline`'s `actorId` filter (D12) is still unconfirmed by the owner.** Phase 2 does
   not touch it, but Phase 3 will.
6. **`scripts/bench.ts` is the one remaining stub** — it is Phase 3 (P3-12).