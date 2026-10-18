import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../server/app.js';

const ACC = 'application/json, text/event-stream';
const INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '1.0' },
  },
};

let server: Server;
let base: string;

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { Accept: ACC, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/** The SDK replies over SSE; pull the JSON payload out of the `data:` line. */
function payload(text: string): Record<string, unknown> {
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data:'));
  if (!line) throw new Error(`No SSE data frame in: ${text}`);
  return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
}

beforeAll(async () => {
  const { app } = createApp({
    // Prove the tools/list + tools/call loop without polluting the real
    // 8-tool surface (those land in Phase 3).
    registerTools: (mcp) => {
      mcp.registerTool(
        'probe_echo',
        {
          title: 'Probe echo',
          description: 'Echoes its input. Test-only.',
          inputSchema: { value: z.string().min(1) },
          outputSchema: { echoed: z.string() },
        },
        ({ value }) => ({
          structuredContent: { echoed: value },
          content: [{ type: 'text', text: JSON.stringify({ echoed: value }) }],
        }),
      );
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('P0-2/P0-5 · MCP handshake and session lifecycle', () => {
  it('initialize returns a session id and negotiates the track floor version', async () => {
    const res = await post(INIT_BODY);
    expect(res.status).toBe(200);
    const sid = res.headers.get('mcp-session-id');
    expect(sid, 'PRD §9.4 — session id at init').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const body = payload(res.text) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe('2025-11-25');
  });

  it('lists tools on an established session, with a JSON Schema input schema', async () => {
    const init = await post(INIT_BODY);
    const sid = init.headers.get('mcp-session-id')!;
    const res = await post(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-11-25' },
    );
    const body = payload(res.text) as {
      result: { tools: { name: string; inputSchema: Record<string, unknown> }[] };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual(['probe_echo']);
    const schema = body.result.tools[0]!.inputSchema;
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('value');
    // Plan D2: no $ref / $defs anywhere in the emitted schema.
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
    expect(JSON.stringify(schema)).not.toContain('"$defs"');
  });

  it('calls a tool and returns structuredContent plus an identical text block', async () => {
    const init = await post(INIT_BODY);
    const sid = init.headers.get('mcp-session-id')!;
    const res = await post(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'probe_echo', arguments: { value: 'hi' } } },
      { 'mcp-session-id': sid },
    );
    const body = payload(res.text) as {
      result: { structuredContent: unknown; content: { type: string; text: string }[] };
    };
    expect(body.result.structuredContent).toEqual({ echoed: 'hi' });
    expect(body.result.content[0]!.type).toBe('text');
    expect(JSON.parse(body.result.content[0]!.text)).toEqual(body.result.structuredContent);
  });

  it('terminates a session on DELETE, then 404s on reuse', async () => {
    const init = await post(INIT_BODY);
    const sid = init.headers.get('mcp-session-id')!;
    const del = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: { Accept: ACC, 'mcp-session-id': sid },
    });
    expect(del.status).toBe(200);
    const reuse = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { 'mcp-session-id': sid });
    expect(reuse.status).toBe(404);
  });

  it('400s a non-initialize request with no session, 404s an unknown session', async () => {
    const noSess = await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    expect(noSess.status).toBe(400);

    const unknown = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, {
      'mcp-session-id': '11111111-2222-3333-4444-555555555555',
    });
    expect(unknown.status).toBe(404);
  });

  it('answers malformed JSON with a JSON-RPC parse error, not a crash', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { Accept: ACC, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: number } }).toMatchObject({ error: { code: -32700 } });
  });
});

describe('P0-4 · Origin validation (DNS-rebinding defence, plan D5)', () => {
  it('403s an untrusted origin', async () => {
    const res = await post(INIT_BODY, { Origin: 'https://evil.com' });
    expect(res.status).toBe(403);
  });

  it('allows the Vite dev origin and the same-origin client', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', base]) {
      const res = await post(INIT_BODY, { Origin: origin });
      expect(res.status, `origin ${origin} should be allowed`).toBe(200);
    }
  });

  it('allows a request with no Origin header at all (zero-config handshake)', async () => {
    const res = await post(INIT_BODY);
    expect(res.status).toBe(200);
  });
});

describe('P0-7 · static client + HTTP surface', () => {
  it('serves /healthz', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('405s GET /mcp without an SSE-capable Accept header', async () => {
    const res = await fetch(`${base}/mcp`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(405);
  });

  it('serves the built client shell at /', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<div id="root">');
  });
});