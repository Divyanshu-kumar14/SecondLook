/**
 * R5 `UNAUTHORIZED_PLAN_CHANGE` (Phase 2, task P2-6).
 *
 * Fires when an `authority.change_refused` exists whose requester role was
 * below `full`. Severity high. ONE HIT PER REQUEST, not per attempt, so
 * retrying a refusal does not inflate the finding count.
 */
import type { CareState } from '../fold.js';
import { displayNameFor } from '../identity.js';
import { formatWhen, type RuleHit } from './types.js';

export const R5 = 'R5';

export function r5UnauthorizedPlanChange(state: CareState, asOf: string): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const hits: RuleHit[] = [];

  for (const refusal of state.refusals.values()) {
    if (Date.parse(refusal.ts) > asOfMs) continue;
    if (refusal.requesterRole === 'full') continue;

    const med = state.medications.get(refusal.medicationId);
    const medName = med?.name.value ?? refusal.medicationId;
    const who = displayNameFor(refusal.requesterId);

    hits.push({
      ruleId: R5,
      severity: 'high',
      what: `${who} asked to change the ${medName} regimen, which is not theirs to change (role ${refusal.requesterRole}). The request was refused on ${formatWhen(refusal.ts)}.`,
      evidence: [refusal.eventId],
      when: refusal.ts,
      nextAction: 'ASK_AUTHORIZED_CAREGIVER',
      // Per request, so retries collapse into one finding.
      groupKey: `request:${refusal.requestId}`,
      medicationId: refusal.medicationId,
      anchorEventId: refusal.eventId,
      anchorTs: refusal.ts,
    });
  }

  return hits;
}