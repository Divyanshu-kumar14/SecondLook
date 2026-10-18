/**
 * Browser-side MCP client (Phase 4).
 *
 * This speaks REAL MCP to `/mcp` using the official SDK. It deliberately does
 * NOT read the event log or the fold directly — DoD #6 requires the demo to run
 * without touching storage, so every answer the UI shows came back over the wire
 * from a tool.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Demo personas. Non-secret fixture values, exactly as the README says. */
export interface Persona {
  id: string;
  name: string;
  role: 'full' | 'record' | 'none' | 'guest';
  token?: string;
  blurb: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'guest',
    name: 'Guest',
    role: 'none',
    blurb: 'No token. Can read, cannot give authority.',
  },
  {
    id: 'priya',
    name: 'Priya',
    role: 'full',
    token: 'demo-priya',
    blurb: 'Full authority. Can change a regimen.',
  },
  {
    id: 'tom',
    name: 'Tom',
    role: 'record',
    token: 'demo-tom',
    blurb: 'Record only. Can log a dose, cannot change a regimen.',
  },
  {
    id: 'elena',
    name: 'Elena',
    role: 'none',
    token: 'demo-elena',
    blurb: 'No authority. Her dose is still logged, and still flagged.',
  },
];

export interface CallResult<T = Record<string, unknown>> {
  structured: T;
  text: string;
  /** Server round-trip in milliseconds, measured in the browser. */
  ms: number;
  isError: boolean;
}

export interface ConnectionInfo {
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  sessionId: string | null;
  toolCount: number;
  tools: string[];
  connectedAt: string;
}

class McpConnection {
  readonly #client: Client;
  readonly #transport: StreamableHTTPClientTransport;
  #info: ConnectionInfo | null = null;

  private constructor(endpoint: URL, token?: string) {
    this.#client = new Client({ name: 'second-look-demo-client', version: '0.1.0' });
    this.#transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    });
  }

  static async connect(token?: string): Promise<McpConnection> {
    const endpoint = new URL('/mcp', window.location.origin);
    const connection = new McpConnection(endpoint, token);
    await connection.#client.connect(connection.#transport);
    const version = connection.#client.getServerVersion();
    const listed = await connection.#client.listTools();

    // The SDK's Client does not expose the negotiated protocol version, so we do
    // NOT guess it. `rawProbe` performs a real handshake over plain fetch and
    // reports what the server actually answered — which is exactly what a
    // Protocol Inspector is for.
    const probe = await rawProbe(endpoint);

    connection.#info = {
      protocolVersion: probe.protocolVersion,
      serverName: version?.name ?? probe.serverName,
      serverVersion: version?.version ?? probe.serverVersion,
      sessionId: connection.#transport.sessionId ?? null,
      toolCount: listed.tools.length,
      tools: listed.tools.map((t) => t.name),
      connectedAt: new Date().toISOString(),
    };
    return connection;
  }

  get info(): ConnectionInfo | null {
    return this.#info;
  }

  async call<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallResult<T>> {
    const started = performance.now();
    const result = await this.#client.callTool({ name, arguments: args });
    const ms = performance.now() - started;

    const first = (result.content as { type: string; text?: string }[] | undefined)?.[0];
    const text = first?.text ?? '';

    // A refusal is a SUCCESSFUL result, so `isError` is the only signal that
    // distinguishes a refusal from a real failure.
    return {
      structured: (result.structuredContent ?? {}) as T,
      text,
      ms,
      isError: result.isError === true,
    };
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export { McpConnection };

/**
 * A raw MCP handshake over plain `fetch`, independent of the SDK session.
 *
 * This is what feeds the Protocol Inspector. It exists because the negotiated
 * protocol version is only visible in the initialize RESPONSE, and the SDK's
 * Client does not surface it — so rather than display a constant, we perform the
 * handshake and read what actually came back.
 */
export async function rawProbe(endpoint: URL): Promise<{
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  sessionId: string | null;
}> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'protocol-inspector', version: '0.1.0' },
      },
    }),
  });

  const sessionId = response.headers.get('mcp-session-id');
  const body = await response.text();

  // The server answers over SSE by default; pull the JSON frame out.
  const frame = body
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice(6)
    .trim();

  const empty = {
    protocolVersion: 'unknown',
    serverName: 'unknown',
    serverVersion: 'unknown',
    sessionId,
  };
  if (!frame) return empty;

  const parsed = JSON.parse(frame) as {
    result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };
  };

  return {
    protocolVersion: parsed.result?.protocolVersion ?? 'unknown',
    serverName: parsed.result?.serverInfo?.name ?? 'unknown',
    serverVersion: parsed.result?.serverInfo?.version ?? 'unknown',
    sessionId,
  };
}