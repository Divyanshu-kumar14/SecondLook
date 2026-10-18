/**
 * HTTP entry point (Phase 0, task P0-7).
 * Zero environment variables required — every setting has a working default.
 */
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';

const { app, sessions, clientDir } = createApp();

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
  console.log(`[second-look]   log mode     : ${config.logMode} -> ${config.logFile}`);
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