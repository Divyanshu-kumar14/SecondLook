/**
 * R6 `UNAUTHORIZED_ADMINISTRATION` (Phase 2, task P2-7).
 *
 * Fires when a dose is recorded by an actor whose resolved role is `none`.
 * Severity medium — deliberately NOT a refusal. A real dose that happened must
 * always be recordable; the system flags it after the fact instead.
 *
 * Reads `actorRole` from the EVENT, not from current caregiver state: authority
 * is resolved server-side at write time, so a caregiver's role may have changed
 * since, and the historical truth is what the rule is about.
 */
import type { CareState } from '../fold.js';
import { displayNameFor } from '../identity.js';
import { formatWhen, type RuleHit } from './types.js';

export const R6 = 'R6';

export function r6UnauthorizedAdministration(state: CareState, asOf: string): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const hits: RuleHit[] = [];

  for (const dose of state.doses) {
    if (Date.parse(dose.ts) > asOfMs) continue;
    if (dose.provenance.actorRole !== 'none') continue;

    const med = state.medications.get(dose.medicationId);
    const medName = med?.name.value ?? dose.medicationId;
    const who = displayNameFor(dose.provenance.actorId);

    hits.push({
      ruleId: R6,
      severity: 'medium',
      what: `${who} recorded a ${dose.amountMg} mg dose of ${medName} on ${formatWhen(dose.ts)}, but has no authority to give medication.`,
      evidence: [dose.eventId],
      when: dose.ts,
      nextAction: 'ASK_AUTHORIZED_CAREGIVER',
      groupKey: dose.medicationId,
      medicationId: dose.medicationId,
      anchorEventId: dose.eventId,
      anchorTs: dose.ts,
    });
  }

  return hits;
}