# Phase 3 — MCP tool surface

**Date:** Sun 18 Oct 2026 · **Budget:** 4.0 h · **Status:** ✅ P3-1…P3-10 and P3-12 complete
**⏳ P3-11 (MCP Inspector session) outstanding** — see *Outstanding* below

**Goal:** 8 tools, one intent each, `outputSchema`-validated, fast, and protocol-conformant
with captured evidence.

---

## Exit criteria (PRD §3 Phase 3)

| Criterion | Result | Evidence |
|---|---|---|
| 8 tools with `outputSchema` | ✅ | `tools/list` returns all 8, each with input + output schema |
| Structured results + structured errors | ✅ | identical JSON in `structuredContent` **and** `text`; no stack traces |
| p95 < 150 ms | ✅ | **0.13 ms** measured |
| curl + Inspector transcripts saved | ⚠️ | curl ✅ (`scripts/transcript.sh`); **Inspector ⏳** |
| Origin 403, session honoured, version negotiated | ✅ | **17/17** protocol checks, plus 16/16 in JSON mode |

---

## Task ledger

| ID | Task | Status | Result |
|---|---|---|---|
| **P3-1** | Tool scaffold + shared error shape | ✅ | `_shared.ts`, never leaks a stack trace |
| **P3-2** | `get_current_regimen` · `get_timeline` | ✅ | read paths, provenance and audit filter |
| **P3-3** | `check_dose` dry run | ✅ | **asserts zero events written** |
| **P3-4** | `find_problems` | ✅ | `assurance` + `coverage`, never "all clear" |
| **P3-5** | `explain_problem` · `get_handoff` | ✅ | SBAR, `settled:false` when unresolved |
| **P3-6** | `record_dose` · `request_regimen_change` | ✅ | **DoD #4 — all three refusal outcomes** |
| **P3-7** | Structured results + errors over all 8 | ✅ | contract tested per tool |
| **P3-8** | Descriptions as intents with examples | ✅ | each > 80 chars, all carry example phrases |
| **P3-9** | Protocol compliance sweep | ✅ | **17/17** (SSE) and **16/16** (JSON) |
| **P3-10** | Evidence capture script | ✅ | `scripts/transcript.sh` |
| **P3-11** | MCP Inspector session | ⏳ | **outstanding — needs a GUI** |
| **P3-12** | Bench — p95 < 150 ms, 500 events < 50 ms | ✅ | all budgets met |

---

## Verification

### Latency (P3-12)

```
300 iterations on the 19-event demo log; 100 on a 500-event log.

  find_problems (rules only)        p50  0.06 ms   p95  0.10 ms   budget 150 ms   PASS
  find_problems (full tool path)    p50  0.06 ms   p95  0.13 ms   budget 150 ms   PASS
  check_dose (projects a dose)      p50  0.07 ms   p95  0.09 ms   budget 150 ms   PASS
  find_problems on 500 events       p50 16.18 ms   p95 18.59 ms   budget  50 ms   PASS
  cold fold on 500 events           p50  0.02 ms   p95  0.03 ms   budget  25 ms   PASS
```

p95 is **~1000× under budget**. `scripts/bench.ts` exits non-zero if any budget regresses, so
this is a gate rather than a one-off measurement.

### Protocol sweep (P3-9)

```
§9.1  POST + Accept: json, event-stream          ✅ 200 + session id
§9.2  application/json OR text/event-stream      ✅ both, selectable (D22)
§9.3  SSE priming frame                          ✅ event frame opened
§9.4  session id: UUID / 400 missing / 404 term.  ✅ all four cases
§9.5  version accepted / invalid->400 / absent    ✅ all three
§9.6  Origin: evil 403, same-origin 200, :5173   ✅ all three
§9.7  bind 127.0.0.1                             ✅ loopback only
§9.8  GET without SSE -> 405; DELETE -> 200      ✅ both
§9.9  UTF-8, one message per stream              ✅
                                          passed: 17   failed: 0
```

Re-run in JSON mode: **16/16** (the priming-frame check is correctly not applicable).

### Test suite

```
npm run verify   →  typecheck ✅  lint ✅  coverage gate ✅
Test Files  11 passed (11)
     Tests  168 passed (168)        (was 146 after Phase 2)
```

### The demo spine, live

```
$ scripts/transcript.sh
find_problems   → FINDINGS_PRESENT, 3 findings, coverage{scannedEvents:16, unloggedExpectedDoses:7}
check_dose      → DO_NOT_GIVE / STOP_GIVING  (ibuprofen, stopped and barred)
request_regimen_change (Elena) → refused + whoCan + pendingRequestId   ← DoD #4
get_timeline type=authority.*   → the audit log, refusal visible
Origin https://evil.com         → 403
```

---

## Two bugs the transcript caught that tests did not

1. **`check_dose` leaked `"hypothetical"` into evidence** (F24). The tests passed — nothing
   asserted the evidence was *real*. A phantom id in a spoken answer undermines the whole
   "we prove it" claim. Now stripped, with a test asserting every cited id resolves to a real
   event.
2. **The SDK answers before our handler runs** (F25), so malformed-argument errors lack
   `structuredContent`. Recorded as **D21** with the reasoning for keeping strict schemas —
   `required` in `tools/list` is worth more to a client than uniform error shape.

Plus F26 (discriminated-union narrowing stops through an alias — the *second* time that lesson
this project) and F27.

---

## Design decisions this phase

| ID | Decision |
|---|---|
| **D21** | Keep strict input schemas; document that SDK pre-validation preempts our error shape |
| **D22** | Both MCP response modes supported and selectable via `SL_MCP_JSON_RESPONSE` |

---

## Outstanding

**P3-11 — MCP Inspector session.** This is the one Phase 3 item not done. It needs the
Inspector GUI (`npx @modelcontextprotocol/inspector`) driven by a person, and DoD #2 requires
the session to appear in the README. The programmatic equivalents already exist —
`scripts/transcript.sh` and `scripts/verify-protocol.sh` — but they are not the same artefact
and I am not going to claim otherwise.

**P5-1 — clean-container run.** Last done before Phase 3 existed; must be re-run (see
`PHASE-2-SUMMARY.md` carry-forward).

---

## Carried into Phase 4

1. **`asOf` is injected everywhere.** The tool path never reads the wall clock — keep it that way
   or the demo stops being reproducible.
2. **The client must call the real tools over `/mcp`**, not read the log directly (DoD #6). The
   store is server-side and must stay there.
3. **Phrasing must be labelled simulated.** The router and phrase templates are deterministic
   stand-ins for Alexa+, and the UI must say so.
4. **Actor as provenance, never as cause** — the evidence drawer shows who recorded something,
   not who is to blame for a rule firing.
5. **Findings are stable ids.** The client should key on `findingId`, never on an index.