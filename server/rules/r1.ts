/**
 * R1 `DOSE_INTERVAL` (Phase 2, task P2-2).
 *
 * Fires when two doses of one medication are closer together than the
 * prescribed interval minus tolerance (default 30 min).
 * Severity is medium, and HIGH if the rolling 24 h total exceeds `maxDailyMg`.
 *
 * Performance: doses are pre-grouped per medication with parsed timestamps
 * (see dose-index.ts) — the O(D) scan-and-reparse per medication, and the
 * rolling-window rescan per hit, became one O(1) lookup per medication. The
 * window itself is a contiguous suffix of the sorted dose list, so it is
 * summed in place: forward iteration keeps the reduce in the same order the
 * inline filter had, so the mg total is bit-identical, not merely equal.
 */
import type { CareState } from '../fold.js';
import { doseIndexFor } from './dose-index.js';
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
  const byMed = doseIndexFor(state).byMed;

  for (const med of state.medications.values()) {
    const intervalMs = med.frequencyHours.value * HOUR_MS;
    const windowStart = asOfMs - DAY_MS;

    // Same subset and order as the previous inline filter+sort. Sorting a
    // timestamps-precomputed slice loses the Parse-per-comparison cost and —
    // because equal keys keep insertion order in a stable sort — yields the
    // exact same arrangement.
    const doses = (byMed.get(med.id) ?? [])
      .filter((d) => d.ms <= asOfMs)
      .sort((a, b) => a.ms - b.ms);

    for (let i = 1; i < doses.length; i += 1) {
      const previous = doses[i - 1]!;
      const current = doses[i]!;
      const gapMs = current.ms - previous.ms;
      if (gapMs >= intervalMs - toleranceMs) continue;

      const evidence = [previous.dose.eventId, current.dose.eventId];

      // Escalate when the rolling 24 h total breaches the prescribed cap.
      // Ascending order, contiguous suffix: no per-hit re-scan.
      let start = doses.length;
      while (start > 0 && doses[start - 1]!.ms > windowStart) start -= 1;
      let totalMg = 0;
      for (let j = start; j < doses.length; j += 1) {
        totalMg += doses[j]!.dose.amountMg;
      }

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
        when: current.dose.ts,
        nextAction: 'CONTACT_PRESCRIBER',
        groupKey: med.id,
        medicationId: med.id,
        anchorEventId: previous.dose.eventId,
        anchorTs: previous.dose.ts,
      });
    }
  }

  return hits;
}
