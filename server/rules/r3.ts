/**
 * R3 `SUPERSEDED_IN_USE` (Phase 2, task P2-4).
 *
 * Fires when a dose is recorded AFTER that medication's discontinue or
 * supersede event. Severity critical — this is the rule that catches the §7
 * Day 5 doses of ibuprofen that Priya had already stopped on Day 3.
 *
 * Performance: doses come pre-grouped per medication (dose-index.ts) instead
 * of a full dose-array scan per discontinued medication; iteration order is
 * the log order either way, so hit order — and every downstream finding id —
 * is unchanged.
 */
import type { CareState } from '../fold.js';
import { doseIndexFor } from './dose-index.js';
import { formatWhen, type RuleHit } from './types.js';

export const R3 = 'R3';

export function r3SupersededInUse(state: CareState, asOf: string): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const hits: RuleHit[] = [];
  const byMed = doseIndexFor(state).byMed;

  for (const med of state.medications.values()) {
    if (med.status.value !== 'discontinued') continue;
    const stopTs = med.status.provenance.ts;
    const stopMs = Date.parse(stopTs);

    for (const { dose, ms } of byMed.get(med.id) ?? []) {
      if (ms <= stopMs || ms > asOfMs) continue;

      const confirmed = med.discontinuedPrescriberConfirmed?.value === true;

      hits.push({
        ruleId: R3,
        severity: 'critical',
        what: `${med.name.value} was given on ${formatWhen(dose.ts)}, after it was stopped on ${formatWhen(stopTs)}${confirmed ? '' : ' — and that stop was never confirmed by the prescriber'}.`,
        evidence: [med.status.provenance.eventId, dose.eventId],
        when: dose.ts,
        nextAction: 'STOP_GIVING',
        groupKey: med.id,
        medicationId: med.id,
        anchorEventId: med.status.provenance.eventId,
        anchorTs: stopTs,
      });
    }
  }

  return hits;
}
