/**
 * R4 `CLASS_BARRED_BY_PLAN` (Phase 2, task P2-5).
 *
 * TWO MODES, per PRD §0 #7:
 *   • LATENT    — a medication in a barred class was PRESCRIBED. Severity high.
 *   • ADMINISTERED — it was actually GIVEN. Severity critical.
 *
 * The bar itself always comes from a sourced `plan.constraint_set` event, never
 * from clinical judgement in code (PRD §6.3). This module enforces the plan's
 * constraint; it does not diagnose.
 */
import type { CareState } from '../fold.js';
import { drugClass } from '../formulary.js';
import { formatWhen, type RuleHit } from './types.js';

export const R4 = 'R4';

export function r4ClassBarredByPlan(state: CareState, asOf: string): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const barred = new Set(state.planConstraints.value.barredClasses);
  const reason = state.planConstraints.value.reason;
  const hits: RuleHit[] = [];

  if (barred.size === 0) return hits;

  for (const med of state.medications.values()) {
    const cls = drugClass(med.name.value);
    if (cls === undefined || !barred.has(cls)) continue;

    // The anchor is whichever came first: the plan bar, or the prescription.
    const prescribedAnchor =
      Date.parse(state.planConstraints.provenance.ts) <= Date.parse(med.prescribedAt.ts)
        ? state.planConstraints.provenance
        : med.prescribedAt;

    const prescribedHit: RuleHit = {
      ruleId: R4,
      severity: 'high',
      what: `${med.name.value} is a ${cls}, which the plan bars (${reason}), and it is still on the list.`,
      evidence: [state.planConstraints.provenance.eventId, med.prescribedAt.eventId],
      when: med.prescribedAt.ts,
      nextAction: 'CONTACT_PRESCRIBER',
      groupKey: med.id,
      medicationId: med.id,
      anchorEventId: prescribedAnchor.eventId,
      anchorTs: prescribedAnchor.ts,
    };

    // ADMINISTERED mode supersedes the latent one: it is strictly more severe.
    const administered = state.doses
      .filter((d) => d.medicationId === med.id)
      .filter((d) => Date.parse(d.ts) <= asOfMs)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    if (administered.length > 0) {
      const last = administered[administered.length - 1]!;
      hits.push({
        ruleId: R4,
        severity: 'critical',
        what: `${med.name.value} is a ${cls}, which the plan bars (${reason}), and it was given on ${formatWhen(last.ts)}.`,
        evidence: [state.planConstraints.provenance.eventId, ...administered.map((d) => d.eventId)],
        when: last.ts,
        nextAction: 'STOP_GIVING',
        groupKey: med.id,
        medicationId: med.id,
        anchorEventId: prescribedHit.anchorEventId,
        anchorTs: prescribedHit.anchorTs,
      });
    } else {
      hits.push(prescribedHit);
    }
  }

  return hits;
}