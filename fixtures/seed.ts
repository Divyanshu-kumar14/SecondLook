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
import { buildAcknowledgements, buildScenario } from './scenario.js';

export interface SeedResult {
  log: EventLog;
  count: number;
  sha256: string;
}

export function seedDemoLog(file: string): SeedResult {
  // `demo` truncates first, so this is always a clean deterministic build.
  const log = EventLog.open(file, 'demo');
  const written = log.append(buildScenario());

  // Second pass: acknowledgements must name the finding they acknowledge, and
  // the finding id depends on real anchor event ids already in the chain (D3).
  const refusal = written.find((e) => e.type === 'authority.change_refused');
  const firstAcetaminophenDose = written.find(
    (e) => e.type === 'dose.recorded' && e.payload.medicationId === 'med-acetaminophen',
  );
  if (!refusal || !firstAcetaminophenDose) {
    throw new Error('Seed aborted: could not locate the anchor events for acknowledgements.');
  }
  log.append(buildAcknowledgements(refusal.eventId, firstAcetaminophenDose.eventId));

  const result = log.verify();
  if (!result.ok) {
    throw new Error(`Seed produced an invalid chain at index ${result.failedAt}: ${result.reason}`);
  }

  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  return { log, count: log.length, sha256 };
}