# Phase 4 — Demo client, UI and accessibility

**Window:** Fri 17 Oct – Sun 18 Oct 2026
**Branch:** `main` (one commit per layer, each gated before commit)
**Outcome:** 11 of 11 tasks coded. P4-11 (demo dry run) remains open and needs a human.

## Exit criteria (PRD §3 Phase 4)

| # | Criterion | State |
|---|---|---|
| 1 | Persona switcher reconnects and the actor is resolved from a real bearer token | ✅ |
| 2 | Every utterance reaches a real MCP tool call — never the log or the fold | ✅ |
| 3 | Spoken answer ≤ 25 words, findings phrased for a listener not a screen | ✅ |
| 4 | Findings show severity and open their evidence on demand | ✅ |
| 5 | Transcript is real text in a live region, not a log of paraphrase | ✅ |
| 6 | Latency HUD reads from measured round-trips | ✅ |
| 7 | Protocol inspector shows the **negotiated** version, not a hard-coded one | ✅ |
| 8 | Audit log and handover render as views, not as one spoken sentence | ✅ |
| 9 | WCAG 2.2 AA, keyboard-complete, `prefers-reduced-motion` honoured | ⚠️ code-level ✅, human-verified ⏳ |
| 10 | Demo spine runs unassisted | ⏳ needs the user |

## Task ledger

| ID | Task | Commit |
|---|---|---|
| P4-T0 | MCP client over the SDK, utterance router, phrasing layer, personas | `ed38b15` and earlier |
| P4-4 | Findings list + evidence drawer (loading / loaded / failed) | `ed38b15` |
| P4-5 | Transcript | `ed38b15` |
| P4-6 | Latency HUD | `ed38b15` |
| P4-7 | Protocol inspector | `ed38b15` |
| P4-10 | A11y: roles, live regions, focus, reduced-motion | `ed38b15` |
| — | Tailwind v4 + Motion rebuild (**D26**) | `535349a` |
| P4-8 | Audit log view | `6ed3e6a` |
| P4-9 | Handover panel (SBAR + unresolved + blocking) | `6ed3e6a` |
| — | Responsive pass, `DESIGN.md` | `6ed3e6a` |

## Verification

### Test suite
```
Test Files  13 passed (13)
     Tests  205 passed (205)
Lines        : 94.81% ( 311/328 )
```
205 after the Phase 5 tamper fix added three; 202 at the close of this phase.

### Design detector
```
impeccable detect  →  []        (no findings)
impeccable doctor  →  No drift found.
```
Re-run after Impeccable moved v4.2.0 → v4.6.0, because a pass under the old rules is not a
pass under the new ones. One finding on the first pass: a coloured `border-left` on the turn
cards, flagged as the most recognisable tell of a generated interface. Removed — the speaker was
already labelled.

### Bundle
| | Before | After |
|---|---|---|
| JS | 533 kB | 676 kB (206 kB gzipped) |
| CSS | 7.3 kB | 4.65 kB gzipped |

The growth is Motion, chosen knowingly over CSS-only motion. Recorded with its cost as **D26**
rather than discovered later.

## What this phase actually cost, in bugs

The interface was rewritten twice in twelve hours and **no automated gate caught the worst bug in
it**. The evidence drawer rendered "Show the 0 records behind this" while every test passed: the
rules engine had tests, the tools had tests, and the drawer had a test for a populated list. The
defect lived in the seam between them — findings and their evidence fetched separately and merged
by a key that did not line up — and a human clicking found it in under a minute.

The fix gave the drawer three states instead of one. `items.length === 0` cannot distinguish "not
loaded yet", "nothing found" and "the load failed", and collapsing them is how an empty result
gets presented as a confident answer. That is the exact dishonesty this project exists to
oppose, reproduced inside the project that opposes it. **F28.**

Second bug: `npm run dev` served no proxy, and adding one immediately tripped our own
DNS-rebinding 403. The control was right; the dev proxy was presenting an `Origin` the server had
no reason to trust. Fixed on the proxy side (`changeOrigin`) rather than by widening the
allow-list. **F29, D23.**

## Design decisions this phase

- **D23** — dev proxy rewrites its own origin; the allow-list is never relaxed for convenience.
- **D26** — Tailwind v4 + Motion, with the bundle cost stated rather than absorbed.

The visual direction (calm clinical, colour spent almost entirely on severity, one authored motion
moment) is written up in [`DESIGN.md`](../../DESIGN.md) so the next session inherits the reasoning
rather than reverse-engineering the stylesheet.

## Honest gaps

**Nobody has seen this render.** Every gate passes — typecheck, lint, 205 tests, coverage, build,
design detector — and no human has looked at the rebuilt interface. Automated checks confirm the
code is correct; they do not confirm it is usable, calm, or legible. This is the single largest
open risk in the phase and it is not closable by any tool available to me.

**Responsive is unverified below desktop.** Breakpoints were written and reasoned about; nothing
below `lg` has been rendered on a real screen.

**Tier-0 accessibility is asserted, not witnessed.** `prefers-reduced-motion` is honoured at two
independent layers, focus rings are themed, and the transcript is a live region. All of it is
code-level conformance. Seeing it work requires a human with the OS setting toggled.

## Outstanding

| Item | Why it is blocked |
|---|---|
| **P4-11** demo dry run + screencast | Needs the user to click through and record |
| Human verification of the rebuilt UI | Same |
| Mobile rendering | Same |

## Carried into Phase 5

- P5-1 clean-container run — the plan's top fatal risk, now tested (**D24**)
- P5-5 security review — the plan names a `security-auditor` agent that **does not exist** in this
  setup. Flagged rather than silently substituted.
- P3-11 MCP Inspector session — DoD #2 requires it in the README