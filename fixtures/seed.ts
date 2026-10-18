/**
 * Shared demo-log bootstrap (Phase 1, task P1-9 / plan D4).
 *
 * Used by BOTH `scripts/seed.ts` and the server boot path, so the demo can
 * never drift between the two. `demo` mode truncates and re-seeds a
 * byte-identical log every time, which is what makes every judge run and every
 * recording identical (PRD §7).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventLog } from '../server/log.js';
import { fold } from '../server/fold.js';
import { findProblems } from '../server/rules/index.js';
import { ACKNOWLEDGEMENTS, AS_OF, buildAcknowledgements, buildScenario } from './scenario.js';

export interface SeedResult {
  log: EventLog;
  count: number;
  sha256: string;
}

export function seedDemoLog(file: string): SeedResult {
  // `demo` truncates first, so this is always a clean deterministic build.
  const log = EventLog.open(file, 'demo');
  log.append(buildScenario());

  // Second pass: acknowledgements must name the finding they acknowledge.
  // Grouping merges rules per medication (PRD §6.5), so the ids are resolved
  // by running the real engine rather than hard-coded — an acknowledgement
  // built from a guessed rule set would silently never match (D3).
  const findings = findProblems(fold(log.all()), AS_OF);
  const targets = ACKNOWLEDGEMENTS.map((plan) => {
    const finding = findings.find((f) => f.rules.includes(plan.requiresRule));
    if (!finding) {
      throw new Error(
        `Seed aborted: no finding contains rule ${plan.requiresRule}, so the ` +
          `acknowledgement scheduled at ${plan.ts} would dangle.`,
      );
    }
    return { findingId: finding.findingId, ts: plan.ts };
  });
  log.append(buildAcknowledgements(targets));

  const result = log.verify();
  if (!result.ok) {
    throw new Error(`Seed produced an invalid chain at index ${result.failedAt}: ${result.reason}`);
  }

  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  return { log, count: log.length, sha256 };
}