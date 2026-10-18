/**
 * Shared rule contract (Phase 2, task P2-1).
 *
 * A rule is a PURE function: `(CareState, asOf) -> RuleHit[]`.
 *   • no `Date.now()`, no I/O, no randomness, no module-level mutable state
 *   • `asOf` is INJECTED — the demo clock is never read from the wall clock
 *
 * Determinism is load-bearing: identical events + identical `asOf` must produce
 * byte-identical output, which is DoD #3 and what makes the golden snapshots in
 * the per-rule tests meaningful.
 */
import type { NextAction, Severity } from '../schemas/events.js';
import type { CareState } from '../fold.js';

export interface RuleHit {
  ruleId: string;
  severity: Severity;
  /** One sentence, plain language. Phrased in Phase 4. */
  what: string;
  /** Event ids backing this claim. Never empty. */
  evidence: string[];
  /** ISO timestamp of the most recent supporting evidence. */
  when: string;
  nextAction: NextAction;
  /**
   * Grouping key. The medication id for R1–R4/R6; `request:<id>` for R5, which
   * is reported per request rather than per medication.
   */
  groupKey: string;
  /**
   * The medication this hit is about. For R5 this is the medication the
   * refused request targeted, NOT the request key — `findingId` is built from
   * the medication (PRD §6.5).
   */
  medicationId: string;
  /**
   * Event id of the EARLIEST supporting evidence. Immutable, because events are
   * never mutated or deleted — this is what keeps `findingId` stable as new
   * evidence accrues (plan D3).
   */
  anchorEventId: string;
  /** ISO timestamp of the earliest supporting evidence. */
  anchorTs: string;
}

export type Rule = (state: CareState, asOf: string) => RuleHit[];

/** Severity ordering. Higher number == more severe, for `severity = max`. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Minutes of slack before a dose interval counts as a violation. */
export const DEFAULT_TOLERANCE_MINUTES = 30;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Stable "in words" timestamp so `what` strings are snapshot-friendly. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${day} ${time}`;
}