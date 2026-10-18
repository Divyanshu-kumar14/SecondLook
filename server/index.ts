/**
 * HTTP entry point (Phase 0, task P0-7).
 * Zero environment variables required — every setting has a working default.
 */
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { seedDemoLog } from '../fixtures/seed.js';
import { EventLog } from './log.js';
import { Store } from './store.js';
import { registerAllTools } from './tools/index.js';
import { AS_OF, PERSON_ID } from '../fixtures/scenario.js';

// Plan D4: in `demo` mode every boot truncates and re-seeds a byte-identical
// log, so the second judge run and the second recording see exactly what the
// first one did. `persist` mode is used by tests and leaves the log alone.
let logSummary = 'persisted (not re-seeded)';
let store: Store;
if (config.logMode === 'demo') {
  const seeded = seedDemoLog(config.logFile);
  store = new Store(seeded.log);
  logSummary = `seeded ${seeded.count} events, sha256 ${seeded.sha256.slice(0, 16)}…`;
} else {
  store = new Store(EventLog.open(config.logFile, 'persist'));
}

// The frozen demo clock (PRD §7) is injected into every tool. The tool path
// never reads the wall clock.
const { app, sessions, clientDir } = createApp({
  registerTools: (mcp) => registerAllTools(mcp, { store, asOf: AS_OF, personId: PERSON_ID }),
});

if (!existsSync(clientDir)) {
  console.error(
    `[startup] Client build not found at ${clientDir}.\n` +
      '           Run "npm run build:client" (or "npm install", which triggers prepare).',
  );
}

const server = app.listen(config.port, config.host, () => {
  console.log(`[second-look] listening on http://${config.host}:${config.port}`);
  console.log(`[second-look]   MCP endpoint : POST|GET|DELETE http://${config.host}:${config.port}/mcp`);
  console.log(`[second-look]   client       : http://${config.host}:${config.port}/`);
  console.log(`[second-look]   log mode     : ${config.logMode} — ${logSummary}`);
  console.log(`[second-look]   origins      : ${config.allowedOrigins.join(', ')}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[second-look] ${signal} received — shutting down gracefully`);
  await sessions.closeAll();
  server.close(() => {
    console.log('[second-look] closed cleanly');
    process.exit(0);
  });
  // Hard backstop so a hung connection cannot block exit (P0-7).
  setTimeout(() => {
    console.error('[second-look] forced exit after 5s shutdown timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));