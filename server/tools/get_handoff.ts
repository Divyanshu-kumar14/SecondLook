/**
 * `get_handoff` — "Hand off to Priya." (P3-5, SBAR)
 *
 * `settled` is FALSE whenever `unresolved` OR `pendingRequests` is non-empty
 * (PRD §8). An acknowledgement does NOT resolve a finding — it records that a
 * human has seen it — so acknowledged-but-unresolved findings stay on the list
 * with their acknowledgement state intact. A pending request is settled only by
 * `resolve_request`, never by being read.
 */
import { WHO_MAY_CHANGE } from '../authority.js';
import { findProblems } from '../rules/index.js';
import { displayNameFor } from '../identity.js';
import { fail, ok, when, type ToolContext } from './_shared.js';
import {
  GetHandoffInput,
  GetHandoffOutput,
  type GetHandoffOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function getHandoff(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = GetHandoffInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'A handoff needs a person and the caregiver receiving it.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask who the handoff is for, e.g. "Hand off to Priya."'],
    });
  }
  const { personId, toCaregiverId } = parsed.data;
  const state = ctx.store.careState();
  const person = state.person?.value;
  const findings = findProblems(state, ctx.asOf);

  if (!person || person.personId !== personId) {
    return fail({
      code: 'UNKNOWN_PERSON',
      message: `No person '${personId}' in the record.`,
      missingFields: [],
      suggestedFollowUp: ['Call get_current_regimen for the list of people in the record.'],
    });
  }

  const unresolved = findings.map((f) => ({
    item: f.what,
    kind: f.rules.join('+'),
    blocking: f.severity === 'critical',
    whoMustResolve: nextOwner(f.nextAction, toCaregiverId),
    evidence: f.evidence,
    ...(f.acknowledged ? { acknowledged: true } : {}),
  }));

  // A request still waiting for an authorised caregiver is exactly the kind of
  // open item a handover must carry: it is not resolved by read access, only by
  // someone who can say yes. Oldest first, so the queue reads like a queue.
  const decidedIds = new Set([
    ...state.appliedChanges.keys(),
    ...state.declinedChanges.keys(),
  ]);
  const pendingRequests = [...state.changeRequests.values()]
    .filter((r) => !decidedIds.has(r.requestId))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.requestId.localeCompare(b.requestId))
    .map((r) => ({
      requestId: r.requestId,
      medicationName: state.medications.get(r.medicationId)?.name.value ?? r.medicationId,
      requesterName: displayNameFor(r.requesterId),
      requestedChange: describeChange(r.newDose, r.newFrequency),
      reason: r.reason,
      when: when(r.ts),
      whoCan: WHO_MAY_CHANGE,
    }));

  const medicationNames = [...state.medications.values()].map((m) => {
    const status = m.status.value === 'active' ? 'active' : 'stopped';
    return `${m.name.value} ${m.doseMg.value} mg ${m.form.value} (${status})`;
  });

  const payload: GetHandoffOut = {
    situation: `${person.name}, ${person.ageYears}. ${person.condition}.`,
    background:
      medicationNames.length > 0
        ? `Currently: ${medicationNames.join('; ')}. Plan bars ${state.planConstraints.value.barredClasses.join(', ') || 'nothing'} — ${state.planConstraints.value.reason}.`
        : 'No medications are recorded.',
    assessment:
      findings.length === 0
        ? 'Nothing was found in the record. This is not an all-clear: it means nothing is recorded that the rules can see.'
        : `${findings.length} unresolved item${findings.length === 1 ? '' : 's'}, worst severity ${findings[0]!.severity}.`,
    recommendation: buildRecommendation(findings),
    // Never true while anything is unresolved or waiting on a decision.
    settled: unresolved.length === 0 && pendingRequests.length === 0,
    unresolved,
    pendingRequests,
    for: displayNameFor(toCaregiverId),
    asOf: ctx.asOf,
  };

  // Parse the payload that actually ships — see F33.
  GetHandoffOutput.parse(payload);
  return ok({ ...payload });
}

function nextOwner(nextAction: string, toCaregiverId: string): string {
  switch (nextAction) {
    case 'STOP_GIVING':
    case 'CONTACT_PRESCRIBER':
      return 'prescriber';
    case 'CHECK_LABEL_WITH_PHARMACY':
      return 'pharmacy';
    case 'ASK_AUTHORIZED_CAREGIVER':
      return toCaregiverId;
    case 'RECORD_MISSING_DOSE':
      return 'current caregiver';
    default:
      return 'current caregiver';
  }
}

function buildRecommendation(findings: ReturnType<typeof findProblems>): string {
  if (findings.length === 0) return 'Carry on recording doses as they happen.';
  const stop = findings.filter((f) => f.severity === 'critical' && f.nextAction === 'STOP_GIVING');
  const rest = findings.filter((f) => !stop.includes(f));
  const parts: string[] = [];
  if (stop.length > 0) parts.push(`Stop giving: ${stop[0]!.what}`);
  if (rest.length > 0) parts.push(`Still open: ${rest.map((f) => f.rules.join('+')).join(', ')}.`);
  return parts.join(' ');
}

/** One phrase for what the requester asked for — used by the pending list. */
function describeChange(newDose?: number, newFrequency?: number): string {
  if (newDose !== undefined && newFrequency !== undefined) {
    return `${newDose} mg every ${newFrequency} h`;
  }
  if (newDose !== undefined) return `${newDose} mg`;
  if (newFrequency !== undefined) return `every ${newFrequency} h`;
  return 'a change to the regimen';
}