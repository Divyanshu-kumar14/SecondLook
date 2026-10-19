/**
 * Shared dose index (performance; the "hash map for nested loops" refactor).
 *
 * R1, R3 and R4 each used to walk every recorded dose once per medication —
 * O(M×D) — and R1 additionally re-ran a 24-hour-window scan ON EVERY HIT, with
 * `Date.parse` (string parsing) recomputed inside filters and sort
 * comparators. On the 500-event stress log the bench showed what that costs:
 * find_problems p50 16.22 ms while the fold itself is ~0.02 ms — superlinear
 * growth, ~270× the time for ~26× the events, and the only place the 50 ms
 * budget could plausibly fail as a demo log grows.
 *
 * The index: doses grouped by medicationId in ONE pass, each timestamp parsed
 * once, cached per state via WeakMap. Rules get O(1) per-med lookups and O(D)
 * total prep instead of an O(M×D) scan each.
 *
 * Invariant the cache rests on: `fold()` builds fresh arrays into a fresh
 * CareState, `FoldCache` hands out that same object between appends, and
 * nothing outside `fold()` mutates `state.doses` — so keying on the state
 * object is sound. On an append the fold is rebuilt, producing a new object;
 * the entry keyed to the old one becomes unreachable and is collected.
 */
import type { CareState, DoseRecord } from '../fold.js';

export interface DoseWithMs {
  dose: DoseRecord;
  /** `Date.parse(dose.ts)`, computed once. ISO timestamps parse deterministically. */
  ms: number;
}

export interface DoseIndex {
  /**
   * medicationId -> doses in LOG (insertion) order. R3 walks this order; R1 and
   * R4 sort their own slice ascending, which a stable sort reduces to a no-op
   * ordering on equal keys — the same order the inline sort produced before.
   */
  byMed: Map<string, DoseWithMs[]>;
}

const CACHE = new WeakMap<CareState, DoseIndex>();

export function doseIndexFor(state: CareState): DoseIndex {
  const cached = CACHE.get(state);
  if (cached) return cached;

  const byMed = new Map<string, DoseWithMs[]>();
  for (const dose of state.doses) {
    const list = byMed.get(dose.medicationId);
    const entry: DoseWithMs = { dose, ms: Date.parse(dose.ts) };
    if (list) list.push(entry);
    else byMed.set(dose.medicationId, [entry]);
  }

  const index: DoseIndex = { byMed };
  CACHE.set(state, index);
  return index;
}
