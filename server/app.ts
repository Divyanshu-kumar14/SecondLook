/**
 * Express app factory: ONE Node process serving `/mcp` and the built client
 * (Phase 0 exit criterion, PRD §5.2). Default bind is 127.0.0.1:8787.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { McpSessionManager } from './mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the project root by walking up to the nearest package.json.
 * Robust across layouts: dist/node/server/app.js (3 levels deep) and
 * server/app.ts under tsx (1 level deep).
 */
export function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate package.json above ${start}. Refusing to start.`);
    }
    dir = parent;
  }
}

export interface CreateAppOptions {
  /** Phase 3 supplies the real registrar; tests inject a probe tool. */
  registerTools?: (mcp: McpServer) => void;
  projectRoot?: string;
}

export interface AppBundle {
  app: express.Express;
  sessions: McpSessionManager;
  clientDir: string;
}

export function createApp(options: CreateAppOptions = {}): AppBundle {
  const projectRoot = options.projectRoot ?? findProjectRoot(here);
  const clientDir = path.resolve(projectRoot, config.clientDir);
  const sessions = new McpSessionManager(options.registerTools);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const isParseFailure = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'type' in err &&
  (err as { type?: unknown }).type === 'entity.parse.failed';

  // Malformed JSON must not crash the process and must answer in JSON-RPC.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ): void => {
      if (isParseFailure(err)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error: request body is not valid JSON' },
            id: null,
          }),
        );
        return;
      }
      next(err);
    },
  );

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, sessions: sessions.sessionCount });
  });

  // MCP endpoint — POST | GET | DELETE, single endpoint per PRD §9.
  app.all('/mcp', (req, res) => {
    void sessions
      .handle(req, res, req.body)
      .catch((err: unknown) => {
        // Fail loudly on the console, but never leak a stack trace over the wire.
        console.error('[mcp] unhandled transport error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal error' },
              id: null,
            }),
          );
        }
      });
  });

  app.use(express.static(clientDir, { index: 'index.html' }));

  // SPA fallback — any non-API GET renders the client shell.
  app.get(/^(?!\/mcp|\/healthz).*/, (_req, res, next) => {
    const indexHtml = path.join(clientDir, 'index.html');
    if (!existsSync(indexHtml)) {
      res.status(503).type('text/plain').send('Client build missing. Run: npm run build:client');
      return;
    }
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });

  return { app, sessions, clientDir };
}