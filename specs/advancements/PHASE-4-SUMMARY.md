# Phase 4 — Demo client, UI and accessibility

Window: Fri 17 Oct to Sun 18 Oct 2026
Branch: `main` (one commit per layer, each gated before commit)
Outcome: 11 of 11 tasks coded. P4-11 (demo dry run) remains open and needs a human.

## Exit criteria (PRD §3 Phase 4)

| # | Criterion | State |
|---|---|---|
| 1 | Persona switcher reconnects and the actor is resolved from a real bearer token | ✅ |
| 2 | Every utterance reaches a real MCP tool call: never the log or the fold | ✅ |
| 3 | Spoken answer ≤ 25 words, findings phrased for a listener not a screen | ✅ |
| 4 | Findings show severity and open their evidence on demand | ✅ |
| 5 | Transcript is real text in a live region, not a log of paraphrase | ✅ |
| 6 | Latency HUD reads from measured round-trips | ✅ |
| 7 | Protocol inspector shows the negotiated version, not a hard-coded one | ✅ |
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
| - | Tailwind v4 + Motion rebuild (D26) | `535349a` |
| P4-8 | Audit log view | `6ed3e6a` |
| P4-9 | Handover panel (SBAR + unresolved + blocking) | `6ed3e6a` |
| - | Responsive pass, `DESIGN.md` | `6ed3e6a` |

## Verification

### Test suite
```
Test Files  13 passed (13)
     Tests  207 passed (207)
Lines        : 95.42% ( 313/328 )
```
The Phase 5 fixes added four, for 207; the count at the close of this phase was 202.

### Design detector
```
impeccable detect  →  []        (no findings)
impeccable doctor  →  No drift found.
```
Re-run after Impeccable moved from v4.2.0 to v4.6.0, because a pass under the old rules is not a
pass under the new ones. The first pass found one issue: a coloured `border-left` on the turn
cards, flagged as the most recognisable tell of a generated interface. Removed; the speaker was
already labelled.

### Bundle
| | Before | After |
|---|---|---|
| JS | 533 kB | 676 kB (206 kB gzipped) |
| CSS | 7.3 kB | 4.65 kB gzipped |

The growth is Motion, a deliberate choice over CSS-only motion. Its cost is recorded as D26.

## What this phase actually cost, in bugs

The interface was rewritten twice in twelve hours, and no automated gate caught the worst bug in
it. The evidence drawer rendered "Show the 0 records behind this" while every test passed: the
rules engine had tests, the tools had tests, and the drawer had a test for a populated list. The
defect lived in the seam between them. Findings and their evidence were fetched separately and
merged by a key that did not line up. A human clicking found it in under a minute.

The fix gave the drawer three states instead of one. `items.length === 0` cannot distinguish "not
loaded yet", "nothing found" and "the load failed", and collapsing them presents an empty result
as a confident answer. F28.

Second bug: `npm run dev` served no proxy, and adding one immediately tripped our own
DNS-rebinding 403. The control was right; the dev proxy presented an `Origin` the server had no
reason to trust. Fixed on the proxy side (`changeOrigin`) instead of widening the allow-list. F29,
D23.

## Design decisions this phase

- D23: dev proxy rewrites its own origin; the allow-list is never relaxed for convenience.
- D26: Tailwind v4 + Motion, with the bundle cost stated.

The visual direction (calm clinical, colour spent almost entirely on severity, one authored motion
moment) is written up in [`DESIGN.md`](../../DESIGN.md) so the next session inherits the reasoning
instead of reverse-engineering the stylesheet.

## Honest gaps

Superseded in Phase 5; recorded here as it stood at the close of Phase 4. The first statement below
was the largest open risk in this phase, now closed. The second was a bug, not a gap.

Nobody had seen this render. Every automated gate passed (typecheck, lint, 205 tests, coverage,
build), and no human had looked at the rebuilt interface. Closed in Phase 5: a live browser check
now drives the demo spine end to end (`npm run verify-ui`, 23/23), and screenshots have been
reviewed. That pass surfaced F33, which had been broken since Phase 3.

Responsive was unverified below desktop. Closed in Phase 5: the check now asserts zero horizontal
overflow at 768 px and 390 px, and both were confirmed visually.

Tier-0 accessibility is asserted, not witnessed. `prefers-reduced-motion` is honoured at two
independent layers, focus rings are themed, and the transcript is a live region. The automated
check confirms durations collapse under a simulated `reduce` preference, but only a person can
confirm it feels right.

One defect was outside what the automated gates could see. F33: four tools returned responses that
violated their own declared `outputSchema`, so any real MCP client rejected them. The evidence
drawer had never rendered. Neither curl nor the in-memory test transport validates output schemas,
which is why 207 tests and a 17/17 protocol sweep passed while the headline feature was broken.

## Outstanding

| Item | Why it is blocked |
|---|---|
| P4-11 demo dry run + screencast | Needs the user to click through and record |
| Human verification of the rebuilt UI | Same |
| Mobile rendering | Same |

## Carried into Phase 5

- P5-1 clean-container run: the plan's top fatal risk, now tested (D24)
- P5-5 security review: the plan names a `security-auditor` agent that does not exist in this
  setup. Flagged.
- P3-11 MCP Inspector session: DoD #2 requires it in the README