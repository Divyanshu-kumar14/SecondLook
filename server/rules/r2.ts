/**
 * R2 `DISPENSE_MISMATCH` (Phase 2, task P2-3).
 *
 * Fires when a dispensed dose OR form differs from the active prescription.
 * Severity high. Catches, for example, a 650 mg ER delivery against a
 * prescribed 500 mg IR — which a layperson would very plausibly give.
 */
import type { CareState } from '../fold.js';
import type { RuleHit } from './types.js';

export const R2 = 'R2';

export function r2DispenseMismatch(state: CareState, asOf: string): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const hits: RuleHit[] = [];

  for (const dispense of state.dispensations) {
    if (Date.parse(dispense.ts) > asOfMs) continue;

    const med = state.medications.get(dispense.medicationId);
    if (!med) continue;

    const expectedDose = med.doseMg.value;
    const expectedForm = med.form.value;
    const doseDiffers = dispense.doseMg !== expectedDose;
    const formDiffers = dispense.form !== expectedForm;
    if (!doseDiffers && !formDiffers) continue;

    const differences: string[] = [];
    if (doseDiffers) {
      differences.push(`${expectedDose} mg prescribed but ${dispense.doseMg} mg dispensed`);
    }
    if (formDiffers) {
      differences.push(`${expectedForm} prescribed but ${dispense.form} dispensed`);
    }

    hits.push({
      ruleId: R2,
      severity: 'high',
      what: `${med.name.value}: the pharmacy dispensed something different from the prescription — ${differences.join(', ')}.`,
      evidence: [med.prescribedAt.eventId, dispense.eventId],
      when: dispense.ts,
      nextAction: 'CHECK_LABEL_WITH_PHARMACY',
      groupKey: med.id,
      medicationId: med.id,
      anchorEventId: med.prescribedAt.eventId,
      anchorTs: med.prescribedAt.ts,
    });
  }

  return hits;
}