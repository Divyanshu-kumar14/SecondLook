/**
 * `find_problems` — "Are we doing this right?" (P3-4, the headline tool)
 *
 * Two things this tool must never do:
 *   • Say "all clear". `assurance` is only ever NONE_FOUND_IN_RECORD or
 *     FINDINGS_PRESENT, because a clean scan of a household record is not proof
 *     that nothing is wrong — it is proof that nothing was RECORDED.
 *   • Return findings without coverage. Every answer states what it looked at,
 *     so an empty result is readable as "nothing recorded in this window", not
 *     as reassurance.
 */
import { findProblems } from '../rules/index.js';
import type { CareState } from '../fold.js';
import { SEVERITY_RANK } from '../rules/types.js';
import { fail, ok, resolvePersonId, type ToolContext } from './_shared.js';
import {
  FindProblemsInput,
  FindProblemsOutput,
  type FindProblemsOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function findProblemsTool(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = FindProblemsInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'That request could not be read.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask about a specific person, e.g. "Are we doing this right for Dad?"'],
    });
  }
  const person = resolvePersonId(ctx, parsed.data.personId);
  if (!person.ok) return fail(person.error);

  const { since, minSeverity } = parsed.data;
  const personId = person.personId;
  const asOf = ctx.asOf;
  const sinceMs = since === undefined ? undefined : Date.parse(since);

  const state = ctx.store.careState();
  const events = ctx.store
    .events()
    .filter((e) => (e.payload as { personId?: string }).personId === personId);

  const all = findProblems(state, asOf).filter((f) => f.medicationId !== '' || f.rules.includes('R5'));
  const threshold = minSeverity === undefined ? -1 : SEVERITY_RANK[minSeverity];

  const findings = all
    .filter((f) => SEVERITY_RANK[f.severity] >= threshold)
    .filter((f) =>
      sinceMs === undefined ? true : Date.parse(f.when) >= sinceMs || f.evidence.length > 0,
    )
    .map((f) => ({
      findingId: f.findingId,
      rules: f.rules,
      severity: f.severity,
      what: f.what,
      evidence: f.evidence,
      when: f.when,
      nextAction: f.nextAction,
      acknowledged: f.acknowledged,
    }));

  const doses = state.doses.filter((d) => state.medications.has(d.medicationId));
  const lastDose = doses.at(-1);

  // Expected-but-unlogged doses: prescribed frequency implies more doses than
  // were recorded. This is the honest counterweight to an empty findings list.
  const unlogged = estimateUnloggedExpectedDoses(state, asOf);

  const payload: FindProblemsOut = {
    findings,
    coverage: {
      scannedEvents: events.length,
      from: events.length > 0 ? (events[0]!.ts satisfies string) : null,
      to: events.length > 0 ? (events.at(-1)!.ts satisfies string) : null,
      lastDoseAt: lastDose?.ts ?? null,
      unloggedExpectedDoses: unlogged,
    },
    assurance: findings.length > 0 ? 'FINDINGS_PRESENT' : 'NONE_FOUND_IN_RECORD',
  };

  FindProblemsOutput.parse(payload);
  return ok(payload as unknown as Record<string, unknown>);
}

/**
 * How many doses were probably due but never recorded, per active medication.
 * Deliberately conservative and approximate — it exists so that "no findings"
 * is never mistaken for "nothing happened".
 */
export function estimateUnloggedExpectedDoses(state: CareState, asOf: string): number {
  const asOfMs = Date.parse(asOf);
  let missing = 0;

  for (const med of state.medications.values()) {
    if (med.status.value === 'discontinued') continue;
    const firstDose = state.doses
      .filter((d) => d.medicationId === med.id)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
    // No doses at all: we cannot say anything about gaps.
    if (!firstDose) continue;

    const startedMs = Date.parse(firstDose.ts);
    const intervalMs = med.frequencyHours.value * 3_600_000;
    const expected = Math.floor((asOfMs - startedMs) / intervalMs);
    const recorded = state.doses.filter((d) => d.medicationId === med.id).length;
    missing += Math.max(0, expected - recorded);
  }

  return missing;
}