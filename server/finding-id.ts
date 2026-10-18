/**
 * Stable finding identifiers (plan decision D3).
 *
 * The PRD §6.5 originally defined `findingId` as a hash of sorted evidence IDs.
 * That is WRONG for an append-only log: the evidence set grows every time a dose
 * is recorded, so an acknowledged finding would silently reappear as "new"
 * mid-demo. D3 redefines it as a hash of
 *
 *     (medicationId, sorted ruleIds, anchorEventId)
 *
 * where `anchorEventId` is the EARLIEST triggering event and is immutable,
 * because events are never mutated or deleted.
 *
 * Front-loaded in Phase 1 so the fixture's `problem.acknowledged` events can
 * reference real finding ids. Phase 2 must use this exact function.
 */
import { createHash } from 'node:crypto';

export function findingIdFor(
  medicationId: string,
  ruleIds: readonly string[],
  anchorEventId: string,
): string {
  // Sorted so rule evaluation order can never change the id.
  const canonical = JSON.stringify({
    medicationId,
    ruleIds: [...ruleIds].sort(),
    anchorEventId,
  });
  return `f-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}