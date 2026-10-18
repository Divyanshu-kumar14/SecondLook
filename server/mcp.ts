/**
 * MCP transport + session wiring (Phase 0, task P0-2).
 *
 * SPIKE FINDINGS — recorded in specs/DECISIONS.md as D1:
 *   • Transport: StreamableHTTPServerTransport (SDK-shipped; not hand-rolled).
 *   • The SDK natively provides session IDs, protocol-version negotiation and
 *     DNS-rebinding/Origin protection, so none of it is hand-rolled (PRD §5.1).
 *   • SDK 1.32.1 declares
 *     SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25","2025-06-18","2025-03-26",
 *     "2024-11-05","2024-10-07"] with LATEST = "2025-11-25" — exactly the track
 *     floor the PRD targets. Version negotiation is delegated to the SDK; we do
 *     not hard-code a single accepted version (plan D1).
 *
 * Tool registration lands in Phase 3 (P3-1..P3-8). Phase 0 requires only that
 * the handshake succeeds with zero environment variables.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { config, originsForPort } from './config.js';

const SESSION_HEADER = 'mcp-session-id';

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const INSTRUCTIONS =
  'Household care reconciliation. Use find_problems for "are we doing this right?", ' +
  'check_dose before giving a medication, and request_regimen_change to change a regimen.';

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

function methodNotAllowed(res: ServerResponse, message: string): void {
  res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, GET, DELETE' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Method Not Allowed: ${message}` },
      id: null,
    }),
  );
}

/**
 * Build the `allowedHosts` list for the SDK's DNS-rebinding check.
 *
 * The SDK compares the `Host` header by EXACT string match, port included.
 * The port in that header is the port the socket is actually bound to, which
 * is NOT always `config.port` (PORT may be overridden, or the server may bind
 * to :0 in tests). DNS rebinding is an attack on the host NAME, so each
 * trusted name is paired with the live local port.
 */
function allowedHostsFor(req: IncomingMessage): string[] {
  const localPort = req.socket.localPort ?? config.port;
  return config.allowedHostNames.map((name) => `${name}:${localPort}`);
}

/**
 * Owns the in-memory session map for one process. One instance per app.
 */
export class McpSessionManager {
  readonly #sessions = new Map<string, McpSession>();
  readonly #registerTools: ((mcp: McpServer) => void) | undefined;

  constructor(registerTools?: (mcp: McpServer) => void) {
    this.#registerTools = registerTools;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  #createMcpServer(): McpServer {
    const mcp = new McpServer(
      { name: 'second-look', version: '0.1.0' },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );
    // Phase 3 supplies all eight tools (P3-1..P3-8).
    this.#registerTools?.(mcp);
    return mcp;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const rawSessionId = req.headers[SESSION_HEADER];
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId : undefined;

    if (method === 'POST') {
      const existing = sessionId ? this.#sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res, parsedBody);
        return;
      }
      // A session ID was supplied but is unknown or already terminated -> 404.
      if (sessionId) {
        jsonRpcError(res, 404, 'Session not found');
        return;
      }
      if (!isInitializeRequest(parsedBody)) {
        // PRD §9.4 — non-initialize without a session ID is 400.
        jsonRpcError(res, 400, 'Bad Request: no valid session ID provided');
        return;
      }

      const server = this.#createMcpServer();
      // NOTE: the SDK mints the session ID while handling the initialize
      // REQUEST, not during connect(). The arrow below closes over `transport`
      // and only runs once the binding is initialised, so `const` is safe here.
      const transport: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id: string) => {
            this.#sessions.set(id, { server, transport });
          },
        onsessionclosed: (id: string) => {
            this.#sessions.delete(id);
          },
          // DNS-rebinding defence — PRD §9.6 / plan P0-4 (task D5).
          enableDnsRebindingProtection: true,
          allowedHosts: allowedHostsFor(req),
          // PRD §9.2 — application/json or text/event-stream.
          enableJsonResponse: config.jsonResponse,
          allowedOrigins: originsForPort(req.socket.localPort ?? config.port),
        });

      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (method === 'GET' || method === 'DELETE') {
      const existing = sessionId ? this.#sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }
      const accept = String(req.headers.accept ?? '');
      if (method === 'GET' && !accept.includes('text/event-stream')) {
        // PRD §9.8 — a GET without an SSE-capable Accept header is 405.
        methodNotAllowed(res, 'GET requires Accept: text/event-stream');
        return;
      }
      jsonRpcError(res, 404, 'Session not found');
      return;
    }

    methodNotAllowed(res, method);
  }

  async closeAll(): Promise<void> {
    const open = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(open.map((s) => s.server.close()));
  }
}