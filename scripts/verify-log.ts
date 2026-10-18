/**
 * Hash-chain verifier (Phase 1, task P1-3).
 *
 * DoD #5: passes on a clean log, FAILS after a one-byte manual edit.
 * Exit 0 = intact, exit 1 = tampered, exit 2 = unreadable.
 */
import { EventLog } from '../server/log.js';
import { config } from '../server/config.js';

function main(): void {
  let log: EventLog;
  try {
    // `persist` mode: verify what is on disk, do NOT truncate and re-seed.
    log = EventLog.open(config.logFile, 'persist');
  } catch (error) {
    console.error(`[verify-log] could not read ${config.logFile}: ${(error as Error).message}`);
    process.exit(2);
    return;
  }

  if (log.length === 0) {
    console.error(`[verify-log] ${config.logFile} is empty. Run "npm run seed" first.`);
    process.exit(2);
    return;
  }

  const result = log.verify();
  if (result.ok) {
    console.log(`[verify-log] OK — ${result.count} events, chain intact.`);
    process.exit(0);
    return;
  }

  console.error(
    `[verify-log] TAMPERED — chain breaks at event ${result.failedAt} of ${result.count}.\n` +
      `             reason: ${result.reason}\n` +
      '             The log is append-only and hash-chained; an edit to any byte\n' +
      '             changes that event hash and every hash after it.',
  );
  process.exit(1);
}

main();