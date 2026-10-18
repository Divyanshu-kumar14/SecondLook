/**
 * Rule registry (Phase 2, tasks P2-1 / P2-11).
 *
 * Deterministic order matters: `allRuleHits` returns hits in registry order, so
 * the grouped findings and their golden snapshots do not depend on Map
 * iteration order or on which rule happens to be added first.
 */
import { fold, type CareState } from '../fold.js';
import type { CareEvent } from '../schemas/events.js';
import { r1DoseInterval } from './r1.js';
import { r2DispenseMismatch } from './r2.js';
import { r3SupersededInUse } from './r3.js';
import { r4ClassBarredByPlan } from './r4.js';
import { r5UnauthorizedPlanChange } from './r5.js';
import { r6UnauthorizedAdministration } from './r6.js';
import { findingsFrom, type Finding } from './group.js';
import type { Rule, RuleHit } from './types.js';

export const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  R1: r1DoseInterval,
  R2: r2DispenseMismatch,
  R3: r3SupersededInUse,
  R4: r4ClassBarredByPlan,
  R5: r5UnauthorizedPlanChange,
  R6: r6UnauthorizedAdministration,
});

export const RULE_IDS = Object.keys(RULES);

export function allRuleHits(state: CareState, asOf: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const id of RULE_IDS) {
    hits.push(...RULES[id]!(state, asOf));
  }
  return hits;
}

export function findProblems(state: CareState, asOf: string): Finding[] {
  return findingsFrom(state, allRuleHits(state, asOf));
}

/** Convenience: fold the events, then run the whole engine. */
export function analyze(events: readonly CareEvent[], asOf: string): Finding[] {
  return findProblems(fold(events), asOf);
}

export * from './types.js';
export * from './group.js';