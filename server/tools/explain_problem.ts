/**
 * `explain_problem` — "Why?" / "Show me." (P3-5)
 *
 * Resolves a finding id back to the whole events behind it. Evidence ids are
 * sorted (D18), so the chronology is recovered here rather than assumed there.
 */
import { findProblems } from '../rules/index.js';
import { displayNameFor } from '../identity.js';
import { fail, ok, when, type ToolContext } from './_shared.js';
import {
  ExplainProblemInput,
  ExplainProblemOutput,
  type ExplainProblemOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function explainProblem(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = ExplainProblemInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'findingId is required.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Call find_problems first and use a findingId from the result.'],
    });
  }
  const { findingId } = parsed.data;
  const state = ctx.store.careState();
  const finding = findProblems(state, ctx.asOf).find((f) => f.findingId === findingId);

  if (!finding) {
    return fail({
      code: 'UNKNOWN_FINDING',
      message: `No finding '${findingId}' in the record as of ${ctx.asOf}.`,
      missingFields: [],
      suggestedFollowUp: ['Call find_problems for the current list of findings.'],
    });
  }

  const byId = new Map(ctx.store.events().map((e) => [e.eventId, e]));
  const events = finding.evidence
    .map((id) => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined)
    // Chronology is recovered here; the stored evidence array is sorted, not ordered.
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .map((e) => ({
      eventId: e.eventId,
      ts: e.ts,
      type: e.type,
      actorName: displayNameFor(e.actorId),
      actorRole: e.actorRole,
      source: e.source,
      payload: e.payload,
    }));

  const derivation = [
    `finding ${finding.findingId} was raised by ${finding.rules.join(' + ')}`,
    `worst severity is ${finding.severity}`,
    ...finding.rules.map((r) => ruleExplanation(r)),
    `earliest supporting event is ${when(events[0]?.ts ?? finding.when)}`,
    `most recent supporting event is ${when(finding.when)}`,
  ];

  const payload: ExplainProblemOut = {
    rules: finding.rules,
    derivation,
    events: events.map((e) => ({ eventId: e.eventId, ts: e.ts, source: e.source })),
    what: finding.what,
    evidenceDetail: events,
    nextAction: finding.nextAction,
    acknowledged: finding.acknowledged,
  };

  // Parse what actually SHIPS. The handler used to validate a three-field
  // payload and then return a wider object, so nothing on the server ever
  // checked the response against the schema the client validates against (F33).
  ExplainProblemOutput.parse(payload);
  return ok({ ...payload });
}

function ruleExplanation(ruleId: string): string {
  switch (ruleId) {
    case 'R1':
      return 'R1: two doses closer together than the prescribed interval allows';
    case 'R2':
      return 'R2: what the pharmacy dispensed differs from the prescription';
    case 'R3':
      return 'R3: a dose was given after the medication was stopped';
    case 'R4':
      return 'R4: the medication belongs to a class the care plan bars';
    case 'R5':
      return 'R5: a regimen change was requested by someone without the authority';
    case 'R6':
      return 'R6: a dose was recorded by a caregiver with no authority to give medication';
    default:
      return `${ruleId}: see the evidence below`;
  }
}