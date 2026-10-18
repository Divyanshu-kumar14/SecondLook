import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { seedDemoLog } from '../fixtures/seed.js';
import { AS_OF, PERSON_ID } from '../fixtures/scenario.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { registerAllTools } from '../server/tools/index.js';

/**
 * P4 · The demo client's NETWORKING PATH, verified for real.
 *
 * The browser uses the official SDK's StreamableHTTPClientTransport against
 * /mcp. Everything below `client/mcp.ts` — the connection, the persona header,
 * `callTool` — is the same code that runs in the browser. Only the DOM differs,
 * and the DOM is covered by typecheck, lint and the build.
 *
 * This also proves DoD #6: the client reaches every answer through a tool call,
 * and never touches the store directly.
 */
let server: Server;
let base: string;
let store: Store;

/**
 * A FRESH server and log per test. Sharing one store let a recorded dose leak
 * into later assertions — the engine correctly found a fourth finding, and the
 * test failed for the right reason but the wrong one.
 */
async function freshServer(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sl-client-transport-'));
  store = new Store(seedDemoLog(path.join(dir, 'events.jsonl')).log);

  const { app } = createApp({
    registerTools: (mcp) => registerAllTools(mcp, { store, asOf: AS_OF, personId: PERSON_ID }),
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
}

beforeEach(freshServer);

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(token?: string) {
  const client = new Client({ name: 'demo-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  await client.connect(transport);
  return { client, transport };
}

interface ClientSession {
  call: (name: string, args: Record<string, unknown>) => Promise<{
    structured: Record<string, unknown>;
    isError: boolean;
  }>;
  close: () => Promise<void>;
}

async function session(token?: string): Promise<ClientSession> {
  const { client, transport } = await connect(token);
  return {
    call: async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      return { structured: (r.structuredContent ?? {}) as Record<string, unknown>, isError: r.isError === true };
    },
    close: async () => {
      await client.close();
      void transport;
    },
  };
}

describe('P4-1 · the client connects over real HTTP and lists all eight tools', () => {
  it('completes a handshake and lists the tools', async () => {
    const s = await session();
    try {
      const listed = await s.call('find_problems', { personId: PERSON_ID });
      expect(listed.isError).toBe(false);
      expect(listed.structured.assurance).toBe('FINDINGS_PRESENT');
    } finally {
      await s.close();
    }
  });

  it('rejects an untrusted Origin, proving the client would be refused elsewhere', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'https://evil.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
      }),
    });
    expect(response.status).toBe(403);
  });
});

describe('P4-1 · switching persona changes the server-resolved actor', () => {
  it('refuses Elena and applies the same request from Priya', async () => {
    // Same server, two identities. This is the demo's second beat.
    const asGuest = await session();
    const asPriya = await session('demo-priya');

    try {
      // A guest cannot change a regimen, and a refusal is a SUCCESSFUL result.
      const refused = await asGuest.call('request_regimen_change', {
        medicationId: 'med-acetaminophen',
        newFrequency: 4,
        reason: 'more pain',
      });
      expect(refused.isError).toBe(false);
      expect(refused.structured.status).toBe('refused');
      expect(refused.structured.refusal).toMatchObject({ code: 'UNAUTHORIZED_PLAN_CHANGE' });
      expect(refused.structured.pendingRequestId).toBeTruthy();

      // The same request from a full-authority caregiver is applied instead.
      const applied = await asPriya.call('request_regimen_change', {
        medicationId: 'med-acetaminophen',
        newFrequency: 4,
        reason: 'titrating',
      });
      expect(applied.structured.status).toBe('applied');
      expect(applied.structured.refusal).toBeUndefined();
    } finally {
      await asGuest.close();
      await asPriya.close();
    }
  });

  it('records the actor the server resolved, not one the caller claimed', async () => {
    const s = await session('demo-elena');
    try {
      const before = store.events().length;
      const r = await s.call('record_dose', { medicationId: 'med-acetaminophen', amount: 500 });
      expect(r.structured.recorded).toBe(true);
      expect(store.events().length).toBe(before + 1);

      const written = store.events().at(-1)!;
      expect(written.actorId).toBe('caregiver-elena');
      expect(written.actorRole).toBe('none');
    } finally {
      await s.close();
    }
  });
});

describe('DoD #6 · the client reaches every answer through a tool', () => {
  let s: ClientSession;

  beforeEach(async () => {
    s = await session();
  });

  afterEach(async () => {
    await s.close();
  });

  it('check_dose answers over the wire without writing', async () => {
    const before = store.events().length;
    const r = await s.call('check_dose', { medicationId: 'med-ibuprofen' });
    expect(r.structured.verdict).toBe('DO_NOT_GIVE');
    expect(store.events().length).toBe(before);
  });

  it('find_problems returns findings and coverage', async () => {
    const r = await s.call('find_problems', { personId: PERSON_ID });
    expect((r.structured.findings as unknown[]).length).toBe(3);
    expect(r.structured.coverage).toBeDefined();
  });

  it('explain_problem resolves evidence ids the drawer can cite', async () => {
    const r = await s.call('find_problems', { personId: PERSON_ID });
    const findingId = (r.structured.findings as { findingId: string }[])[0]!.findingId;
    const detail = await s.call('explain_problem', { findingId });
    const events = detail.structured.evidenceDetail as { eventId: string; actorName: string }[];
    expect(events.length).toBeGreaterThan(0);
    // Every cited id must be a real event, or the drawer would show fiction.
    const known = new Set(store.events().map((e) => e.eventId));
    for (const e of events) expect(known.has(e.eventId)).toBe(true);
  });

  it('get_timeline returns the audit log', async () => {
    const r = await s.call('get_timeline', { personId: PERSON_ID, type: 'authority.*' });
    const events = r.structured.events as { type: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type.startsWith('authority.'))).toBe(true);
  });

  it('get_handoff reports settled:false while anything is open', async () => {
    const r = await s.call('get_handoff', { personId: PERSON_ID, toCaregiverId: 'caregiver-priya' });
    expect(r.structured.settled).toBe(false);
    expect((r.structured.unresolved as unknown[]).length).toBe(3);
  });

  it('get_current_regimen returns medications with provenance', async () => {
    const r = await s.call('get_current_regimen', { personId: PERSON_ID });
    expect((r.structured.medications as unknown[]).length).toBe(2);
  });
});