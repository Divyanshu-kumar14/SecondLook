# Phase 2 — Rules engine

**Date:** Sun 18 Oct 2026 · **Budget:** 5.0 h · **Status:** ✅ R1–R6 complete, all exit criteria met
(deliberately deferred R7/R8 — see *Scope call* below)

**Goal:** R1–R6 as pure functions, deterministic, grouped per medication, ranked, all firing on
the fixture.

---

## Exit criteria (PRD §3 Phase 2)

| Criterion | Result | Evidence |
|---|---|---|
| R1–R6 pure, unit + integration tested | ✅ | 39 unit tests + 16 fixture tests; no `Date.now()`, no I/O, `asOf` injected |
| Grouping + ranking deterministic | ✅ | rotation + reversal permutation test; evidence unions sorted (**D18**) |
| Fixture fires all six | ✅ | R1–R6 all fire; exactly 3 grouped findings |
| Identical output across 3 runs | ✅ | **DoD #3** |
| ≥90 % coverage on the scoped set | ✅ | **94.82 %**; every rule file at **100 %** |

---

## Task ledger

| ID | Task | Status | Result |
|---|---|---|---|
| **P2-1** | `server/rules/` scaffold, shared types, harness | ✅ | `types.ts`, `group.ts`, `index.ts`, `tests/helpers/rules-harness.ts` |
| **P2-2** | R1 `DOSE_INTERVAL` | ✅ | medium → high on rolling-24h cap breach |
| **P2-3** | R2 `DISPENSE_MISMATCH` | ✅ | catches dose **or** form difference |
| **P2-4** | R3 `SUPERSEDED_IN_USE` | ✅ | critical; names the unconfirmed stop |
| **P2-5** | R4 `CLASS_BARRED_BY_PLAN` | ✅ | **both modes** — latent high / administered critical |
| **P2-6** | R5 `UNAUTHORIZED_PLAN_CHANGE` | ✅ | per request, not per attempt |
| **P2-7** | R6 `UNAUTHORIZED_ADMINISTRATION` | ✅ | reads role from the **event**, not current state |
| **P2-8** | Grouping & ranking | ✅ | permutation-tested |
| **P2-9** | Acknowledgement + D3 regression | ✅ | finding id survives appended evidence |
| **P2-10** | R7/R8 stretch | ⏸️ | **deferred** — see below |
| **P2-11** | Fixture assertions, 3-run determinism | ✅ | exactly 3 findings |
| **P2-12** | Coverage gate on scoped include | ✅ | 94.82 %, gate exits 0 |

---

## What the engine finds

```
=== RAW HITS (7) ===
  R1 medium   med-acetaminophen    anchor=2026-10-16T08:00
  R2 high     med-acetaminophen    anchor=2026-10-11T08:20
  R3 critical med-ibuprofen        anchor=2026-10-13T11:00
  R3 critical med-ibuprofen        anchor=2026-10-13T11:00
  R4 critical med-ibuprofen        anchor=2026-10-11T08:10
  R5 high     request:req-elena…    anchor=2026-10-14T09:05
  R6 medium   med-ibuprofen        anchor=2026-10-15T20:00

=== GROUPED (3 findings, ranked) ===
  f-4aca215e40c1  critical  [R3,R4,R6]  ack=false
      ibuprofen was given on 2026-10-15 20:00, after it was stopped on 2026-10-13 11:00
      — and that stop was never confirmed by the prescriber.
  f-6de4292e7ccc  high      [R1,R2]     ack=true
      acetaminophen: the pharmacy dispensed something different from the prescription
      — 500 mg prescribed but 650 mg dispensed, IR prescribed but ER dispensed.
  f-04fef3a7e6f4  high      [R5]        ack=true
      Elena asked to change the acetaminophen regimen, which is not theirs to change (role none).
```

Three findings — exactly the three PRD §7 lists as unresolved at handoff.

---

## Verification

```
npm run verify
  Test Files  10 passed (10)
       Tests  146 passed (146)        (was 88 after Phase 1)

npm test -- --coverage        GATE EXIT=0
  server/authority.ts   100 %
  server/rules/r1..r6   100 %  (every rule)
  server/rules/group.ts  91.17 %
  server/fold.ts         90.27 %
  server/log.ts          92.85 %
  TOTAL                  94.82 %  (threshold 90)
```

---

## Three bugs the tests caught

1. **The fixture's acknowledgement could never match** (F19). PRD §6.5 groups per medication, so
   R1+R2 are ONE finding — but the Phase 1 fixture acknowledged a standalone `['R1']` id the
   engine can never emit. It was dead on arrival, silently. Acknowledgements now resolve through
   the real engine (**D19**).

2. **Real non-determinism in evidence ordering** (F20). The union was accumulated first-seen, so
   rotating the input changed the output. A "3 runs identical" check would never have caught this —
   only the permutation test did. Now sorted (**D18**).

3. **`fold()` was discarding what R5 and R6 need** (F18). Refusals kept no `eventId` and
   `Provenance` had no `actorRole`. Fixed before the rules were written, not after.

---

## Scope call — R7/R8 deferred

P2-10 permits R7/R8 only if Phases 0–1 finished ahead of budget. They did. I stopped anyway,
because implementing R7 **changes the expected output**: PRD §7 has no acetaminophen recorded on
Day 7 08:00–20:00, so R7 `MISSED_DOSE_WINDOW` would fire and the fixture would yield **4**
findings, not the 3 §7 specifies.

R7/R8 are **T2 stretch** under the plan's own cut order. Adding one buys a rule nobody asked for
and breaks an assertion the PRD states. Deferred deliberately, not overlooked.

**This is a call worth confirming** — see the open question below.

---

## Carried into Phase 3

1. **Never hard-code a `findingId`.** Resolve it from `findProblems()` (**D19**).
2. **Rules must stay pure.** Phase 3 tools get `asOf` injected, never `new Date()`.
3. **R6 reads the role from the event**, so promoting a caregiver does not rewrite history.
4. **Findings anchor on oldest evidence** (**D20**) — the ibuprofen finding anchors on the plan
   constraint, not the discontinue. Worth a README line.
5. **Evidence arrays are sorted, not chronological.** `explain_problem` resolves them to whole
   events, which is where ordering belongs.
6. **`scripts/bench.ts` is still the only stub.** Phase 3 (P3-12) needs it — and now has a real
   rules engine to measure.