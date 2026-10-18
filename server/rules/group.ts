/**
 * Grouping and ranking (Phase 2, task P2-8).
 *
 * PRD §6.5: rule hits group PER MEDICATION — R5 per request — into one Finding
 * with `severity = max` and `evidence = union`.
 *
 * `findingId` comes from `server/finding-id.ts` (plan D3). That module is the
 * single definition of the formula; this file MUST import it rather than
 * reimplement the hash.
 */
import { findingIdFor } from '../finding-id.js';
import type { CareState } from '../fold.js';
import type { NextAction, Severity } from '../schemas/events.js';
import { maxSeverity, SEVERITY_RANK, type RuleHit } from './types.js';

export interface Finding {
  findingId: string;
  medicationId: string;
  /** Sorted, de-duplicated. */
  rules: string[];
  severity: Severity;
  what: string;
  /** Union of every hit's evidence, de-duplicated, deterministic order. */
  evidence: string[];
  when: string;
  nextAction: NextAction;
  acknowledged: boolean;
}

/**
 * Union of every hit's evidence, de-duplicated and SORTED.
 *
 * Sorting is required, not cosmetic: first-seen order would make the output
 * depend on the order hits happen to arrive in, which the rotation test in
 * `tests/rules.fixture.test.ts` catches. Lexicographic order is arbitrary but
 * total; chronological ordering belongs in `explain_problem`, where evidence
 * ids resolve back to whole events.
 */
function unionEvidence(hits: RuleHit[]): string[] {
  const seen = new Set<string>();
  for (const hit of hits) {
    for (const id of hit.evidence) seen.add(id);
  }
  return [...seen].sort();
}

/**
 * The lead hit is the one with the highest severity; ties break on the most
 * recent evidence, then ruleId asc — the same total order used for ranking, so
 * the headline sentence is always stable.
 */
function leadHit(hits: RuleHit[]): RuleHit {
  return [...hits].sort(compareHits)[0]!;
}

function compareHits(a: RuleHit, b: RuleHit): number {
  const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sev !== 0) return sev;
  const recency = Date.parse(b.when) - Date.parse(a.when);
  if (recency !== 0) return recency;
  return a.ruleId.localeCompare(b.ruleId);
}

export function groupHits(
  hits: RuleHit[],
  acknowledged: ReadonlySet<string>,
): Finding[] {
  const groups = new Map<string, RuleHit[]>();
  for (const hit of hits) {
    const bucket = groups.get(hit.groupKey);
    if (bucket) bucket.push(hit);
    else groups.set(hit.groupKey, [hit]);
  }

  const findings: Finding[] = [];

  for (const [, group] of groups) {
    const rules = [...new Set(group.map((h) => h.ruleId))].sort();
    const lead = leadHit(group);
    const severity = group.reduce((acc, h) => maxSeverity(acc, h.severity), 'low' as Severity);

    // D3: anchor is the EARLIEST triggering event across the whole group, so
    // appending new evidence never renames the finding.
    const anchor = [...group].sort((a, b) => Date.parse(a.anchorTs) - Date.parse(b.anchorTs))[0]!;
    const medicationId = lead.medicationId;
    const findingId = findingIdFor(medicationId, rules, anchor.anchorEventId);

    findings.push({
      findingId,
      medicationId,
      rules,
      severity,
      what: lead.what,
      evidence: unionEvidence(group),
      when: lead.when,
      nextAction: lead.nextAction,
      acknowledged: acknowledged.has(findingId),
    });
  }

  return rank(findings);
}

/**
 * PRD §6.5 ranking, in order:
 *   severity desc -> distinct rules desc -> most recent evidence ts desc -> ruleId asc
 */
export function rank(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;

    const ruleCount = b.rules.length - a.rules.length;
    if (ruleCount !== 0) return ruleCount;

    const recency = Date.parse(b.when) - Date.parse(a.when);
    if (recency !== 0) return recency;

    // Final tiebreak uses the sorted rule list so the order is total.
    return a.rules.join(',').localeCompare(b.rules.join(','));
  });
}

/** Everything the rule engine knows, in one call. */
export function findingsFrom(state: CareState, hits: RuleHit[]): Finding[] {
  return groupHits(hits, state.acknowledgedProblems);
}