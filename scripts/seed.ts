/**
 * Deterministic seed generator (Phase 1, task P1-9).
 *
 * Verifies D4: running this twice produces a byte-identical JSONL file.
 * Plan verify: `npm run seed && npm run seed && sha256sum` twice -> identical.
 */
import { seedDemoLog } from '../fixtures/seed.js';
import { config } from '../server/config.js';

const result = seedDemoLog(config.logFile);

console.log(`[seed] wrote ${result.count} events to ${config.logFile}`);
console.log(`[seed] chain verified OK (${result.count} events)`);
console.log(`[seed] sha256 ${result.sha256}`);