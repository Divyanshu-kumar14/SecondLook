/**
 * R1 `DOSE_INTERVAL` (Phase 2, task P2-2).
 *
 * Fires when two doses of one medication are closer together than the
 * prescribed interval minus tolerance (default 30 min).
 * Severity is medium, and HIGH if the rolling 24 h total exceeds `maxDailyMg`.
 */
import type { CareState } from '../fold.js';
import {
  DEFAULT_TOLERANCE_MINUTES,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  type RuleHit,
} from './types.js';

export const R1 = 'R1';

export function r1DoseInterval(
  state: CareState,
  asOf: string,
  toleranceMinutes: number = DEFAULT_TOLERANCE_MINUTES,
): RuleHit[] {
  const asOfMs = Date.parse(asOf);
  const hits: RuleHit[] = [];
  const toleranceMs = toleranceMinutes * MINUTE_MS;

  for (const med of state.medications.values()) {
    const intervalMs = med.frequencyHours.value * HOUR_MS;
    const windowStart = asOfMs - DAY_MS;

    const doses = state.doses
      .filter((d) => d.medicationId === med.id)
      .filter((d) => Date.parse(d.ts) <= asOfMs)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    for (let i = 1; i < doses.length; i += 1) {
      const previous = doses[i - 1]!;
      const current = doses[i]!;
      const gapMs = Date.parse(current.ts) - Date.parse(previous.ts);
      if (gapMs >= intervalMs - toleranceMs) continue;

      const evidence = [previous.eventId, current.eventId];

      // Escalate when the rolling 24 h total breaches the prescribed cap.
      const rolling = doses.filter(
        (d) => Date.parse(d.ts) > windowStart && Date.parse(d.ts) <= asOfMs,
      );
      const totalMg = rolling.reduce((sum, d) => sum + d.amountMg, 0);
      const cap = med.maxDailyMg?.value;
      const overCap = cap !== undefined && totalMg > cap;

      const hoursApart = (gapMs / HOUR_MS).toFixed(1);
      const what = overCap
        ? `${med.name.value} was given ${hoursApart} h apart and the last 24 h total ${totalMg} mg exceeds the prescribed maximum of ${cap} mg.`
        : `${med.name.value} was given ${hoursApart} h apart, closer than the prescribed ${med.frequencyHours.value} h interval.`;

      hits.push({
        ruleId: R1,
        severity: overCap ? 'high' : 'medium',
        what,
        evidence,
        when: current.ts,
        nextAction: 'CONTACT_PRESCRIBER',
        groupKey: med.id,
        medicationId: med.id,
        anchorEventId: previous.eventId,
        anchorTs: previous.ts,
      });
    }
  }

  return hits;
}