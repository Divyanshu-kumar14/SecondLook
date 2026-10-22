import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { seedDemoLog } from '../fixtures/seed.js';
import { AS_OF, PERSON_ID } from '../fixtures/scenario.js';
import { Store } from '../server/store.js';
import { registerAllTools } from '../server/tools/index.js';
import { TOOL_NAMES } from '../server/schemas/tools.js';
import { requestRegimenChange } from '../server/tools/request_regimen_change.js';
import { resolveRequest } from '../server/tools/resolve_request.js';
import { recordDose } from '../server/tools/record_dose.js';
import { guestContext } from '../server/tools/_shared.js';
import { GUEST, resolveIdentity } from '../server/identity.js';
import { allRuleHits } from '../server/rules/index.js';

let store: Store;

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sl-tools-'));
  store = new Store(seedDemoLog(path.join(dir, 'events.jsonl')).log);
});

/** Drive the real MCP server over the real transport, with a bearer token. */
async function withServer<T>(run: (client: Client) => Promise<T>, token?: string): Promise<T> {
  const mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerAllTools(mcp, { store, asOf: AS_OF, personId: PERSON_ID });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

  // The SDK's in-memory transport does not carry HTTP headers, so exercise the
  // per-call identity resolution directly at the tool layer as well.
  void token;
  try {
    return await run(client);
  } finally {
    await client.close();
    await mcp.close();
  }
}

function call(client: Client, name: string, args: unknown) {
  return client.callTool({ name, arguments: args as Record<string, unknown> });
}

/** The SDK's client-side result is a union; narrow to the text block. */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  const first = (content as { type: string; text: string }[] | undefined)?.[0];
  expect(first?.type, 'expected a text content block').toBe('text');
  return first!.text;
}

const structured = (result: unknown): Record<string, unknown> =>
  (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};

describe('P3-7 · every tool satisfies the result contract', () => {
  it('registers exactly the 9 tools from the PRD', async () => {
    await withServer(async (client) => {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    });
  });

  it('gives every tool an inputSchema and an outputSchema', async () => {
    await withServer(async (client) => {
      const tools = await client.listTools();
      for (const tool of tools.tools) {
        expect(tool.inputSchema, `${tool.name}.inputSchema`).toBeDefined();
        expect(tool.outputSchema, `${tool.name}.outputSchema`).toBeDefined();
        expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
        // P3-8: descriptions are written as intents with example phrases.
        expect(tool.description!.length, `${tool.name} description is too thin`).toBeGreaterThan(80);
      }
    });
  });

  it('returns the identical JSON in structuredContent and the text block', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'find_problems', { personId: PERSON_ID });
      expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
    });
  });

  it('never leaks a stack trace in a failure', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'check_dose', { medicationId: 'med-does-not-exist' });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).not.toMatch(/at [A-Za-z]+\.[A-Za-z]+ \(/); // no "at fn (file:line)"
      expect(text).not.toContain('node_modules');
      expect(text).not.toContain('/home/');
      expect(structured(result)).toMatchObject({ code: 'UNKNOWN_MEDICATION' });
    });
  });

  it('rejects malformed arguments gracefully, naming the offending field', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'get_handoff', {});
      // The SDK validates against `inputSchema` BEFORE the handler runs, so it
      // answers first. That is deliberate: the strict schema is what tools/list
      // advertises as `required`, which is how a client knows what to send.
      // Our structured {code, message, missingFields, suggestedFollowUp} shape
      // therefore applies to DOMAIN failures, which reach the handler.
      // See DECISIONS.md D21. What matters here is that it stays graceful.
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('toCaregiverId');
      expect(text).not.toMatch(/at [A-Za-z]+\.[A-Za-z]+ \(/);
      expect(text).not.toContain('/home/');
    });
  });

  it('returns the FULL structured error shape for domain failures', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'explain_problem', { findingId: 'f-nope' });
      expect(result.isError).toBe(true);
      const payload = structured(result);
      expect(payload).toMatchObject({ code: 'UNKNOWN_FINDING' });
      expect(typeof payload.message).toBe('string');
      expect(Array.isArray(payload.missingFields)).toBe(true);
      expect(Array.isArray(payload.suggestedFollowUp)).toBe(true);
      // And the identical JSON is in the text block.
      expect(JSON.parse(textOf(result))).toEqual(payload);
    });
  });

  // F33. Every handler used to build a NARROW payload, validate that, and then
  // return a WIDER object via `ok({ ...payload, ...extras })`. The MCP client
  // validates the whole response against `outputSchema`, which is strict
  // (`additionalProperties: false`), so any undeclared field made the call fail
  // with -32602 "Structured content does not match the tool's output schema".
  //
  // Four tools were affected. In the browser this meant the evidence drawer and
  // the handover panel never rendered, and demo beat 2 — the refusal — showed a
  // raw protocol error instead of a refusal. 205 tests and the protocol sweep
  // all passed, because curl does not validate and nothing had called every
  // tool through a real Client.
  //
  // This test is the one that should have existed. It calls every tool with
  // valid arguments and lets the SDK Client enforce the declared contract.
  it('every tool returns output that matches its own declared outputSchema', async () => {
    await withServer(async (client) => {
      // A real finding id, so explain_problem takes its success path.
      const problems = await call(client, 'find_problems', { personId: PERSON_ID });
      const findingId = (
        problems.structuredContent as { findings: { findingId: string }[] }
      ).findings[0]!.findingId;

      const { tools } = await client.listTools();
      const declared = new Map(
        tools.map((t) => [
          t.name,
          {
            properties: Object.keys(t.outputSchema?.properties ?? {}),
            required: t.outputSchema?.required ?? [],
            additionalProperties: t.outputSchema?.additionalProperties,
          },
        ]),
      );

      // `resolve_request` needs a real pending request. Asking without a token
      // refuses and leaves one; the resolve below then takes its refused branch
      // through the same real-client output-schema validation as the rest.
      const asked = await call(client, 'request_regimen_change', {
        medicationId: 'med-acetaminophen',
        reason: 'contract check',
        newDose: 1000,
      });
      const requestId = (asked.structuredContent as { pendingRequestId: string })
        .pendingRequestId;

      const calls: [string, Record<string, unknown>][] = [
        ['get_current_regimen', { personId: PERSON_ID }],
        ['find_problems', { personId: PERSON_ID }],
        ['check_dose', { medicationId: 'med-ibuprofen', amountMg: 800 }],
        ['record_dose', { medicationId: 'med-ibuprofen', amount: 800 }],
        ['request_regimen_change', {
          personId: PERSON_ID,
          medicationId: 'med-acetaminophen',
          reason: 'contract check',
          newDose: 1000,
        }],
        ['resolve_request', { requestId, decision: 'approve' }],
        ['explain_problem', { findingId }],
        ['get_timeline', { personId: PERSON_ID, type: 'authority.*' }],
        ['get_handoff', { personId: PERSON_ID, toCaregiverId: 'caregiver-priya' }],
      ];

      for (const [name, args] of calls) {
        const result = await call(client, name, args);
        const schema = declared.get(name)!;
        const actual = Object.keys(result.structuredContent ?? {});

        // The property check is the point. A real MCP client validates the whole
        // response against this schema, and these schemas are strict, so an
        // undeclared field is a hard -32602 at the client — not a warning.
        const undeclared = actual.filter((k) => !schema.properties.includes(k));
        expect(
          undeclared,
          `${name} returns undeclared field(s); a real client rejects the response. Add them to its output schema.`,
        ).toEqual([]);

        const absent = schema.required.filter((k) => !actual.includes(k));
        expect(absent, `${name} omits required field(s)`).toEqual([]);
      }
    });
  });

  // The refusal branch returns `message`, which was the undeclared field that
  // broke the demo's centrepiece. It needs a role without `full`, so it cannot
  // ride on the loop above.
  it('the REFUSAL branch of request_regimen_change also matches its outputSchema', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'request_regimen_change', {
        personId: PERSON_ID,
        medicationId: 'med-acetaminophen',
        reason: 'contract check',
        newDose: 1000,
      });
      const payload = result.structuredContent as {
        status: string;
        message?: string;
        pendingRequestId?: string;
        refusal?: { whoCan: string };
      };
      // A refusal is a SUCCESSFUL result, never an error.
      expect(result.isError).toBeFalsy();
      expect(payload.status).toBe('refused');
      expect(payload.refusal?.whoCan).toBeTruthy();
      expect(payload.pendingRequestId).toBeTruthy();
      expect(payload.message, 'the refusal must say who can act').toContain('cannot change');
    });
  });
});

describe('P3-3 · check_dose is a dry run that writes NOTHING', () => {
  it('does not append a single event', async () => {
    const before = store.log.length;
    await withServer(async (client) => {
      await call(client, 'check_dose', { medicationId: 'med-ibuprofen' });
    });
    expect(store.log.length).toBe(before);
    expect(store.log.verify().ok).toBe(true);
  });

  it('says DO_NOT_GIVE for ibuprofen, which was stopped', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'check_dose', { medicationId: 'med-ibuprofen' });
      expect(structured(result).verdict).toBe('DO_NOT_GIVE');
      expect(structured(result).nextAction).toBe('STOP_GIVING');
    });
  });

  it('never exposes the projected dose as if it were a real event', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'check_dose', { medicationId: 'med-ibuprofen' });
      const text = textOf(result);
      expect(text).not.toContain('projected-dose-not-recorded');
      expect(text).not.toContain('hypothetical');
    });
  });

  it('cites only real event ids as evidence', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'check_dose', { medicationId: 'med-ibuprofen' });
      const known = new Set(store.events().map((e) => e.eventId));
      for (const reason of structured(result).reasons as { evidence: string[] }[]) {
        for (const id of reason.evidence) {
          expect(known.has(id), `evidence ${id} is not a real event`).toBe(true);
        }
      }
    });
  });
});

describe('DoD #7 · an empty-violation set returns NONE_FOUND_IN_RECORD plus coverage', () => {
  it('never returns "all clear" — it returns coverage', async () => {
    await withServer(async (client) => {
      // Filter to a window where nothing is wrong.
      const result = await call(client, 'find_problems', {
        personId: PERSON_ID,
        minSeverity: 'critical',
        since: '2020-01-01T00:00:00.000Z',
      });
      const payload = structured(result);
      expect(['NONE_FOUND_IN_RECORD', 'FINDINGS_PRESENT']).toContain(payload.assurance);
      expect(payload.assurance).not.toMatch(/clear|safe|ok/i);
      const coverage = payload.coverage as Record<string, unknown>;
      expect(coverage).toBeDefined();
      expect(typeof coverage.scannedEvents).toBe('number');
      expect(typeof coverage.from).toBe('string');
      expect(typeof coverage.to).toBe('string');
      expect(typeof coverage.lastDoseAt).toBe('string');
      expect(typeof coverage.unloggedExpectedDoses).toBe('number');
    });
  });

  it('returns FINDINGS_PRESENT for the full record', async () => {
    await withServer(async (client) => {
      const payload = structured(await call(client, 'find_problems', { personId: PERSON_ID }));
      expect(payload.assurance).toBe('FINDINGS_PRESENT');
      expect((payload.findings as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // The log is not in timestamp order: acknowledgements are appended with the
  // time of the thing they acknowledge. Coverage must still describe the range
  // of timestamps the scan used, or the answer claims to have looked at less
  // than it did.
  it('reports the timestamp range, not the first and last appended line', async () => {
    await withServer(async (client) => {
      const payload = structured(await call(client, 'find_problems', { personId: PERSON_ID }));
      const coverage = payload.coverage as { from: string; to: string };
      const findings = payload.findings as { when: string }[];
      for (const f of findings) {
        expect(Date.parse(coverage.from)).toBeLessThanOrEqual(Date.parse(f.when));
        expect(Date.parse(coverage.to)).toBeGreaterThanOrEqual(Date.parse(f.when));
      }
      expect(Date.parse(coverage.to)).toBeGreaterThanOrEqual(Date.parse('2026-10-17T10:00:00.000Z'));
    });
  });
});

describe('DoD #4 · an unauthorised plan change is refused, logged AND pending', () => {
  it('produces all three outcomes', () => {
    const before = store.log.length;

    const result = requestRegimenChange(
      { ...guestContext(store, AS_OF, PERSON_ID), identity: GUEST },
      { medicationId: 'med-acetaminophen', newFrequency: 4, reason: 'more pain' },
    );
    const payload = result.structuredContent as Record<string, unknown>;

    // (1) REFUSED
    expect(payload.status).toBe('refused');
    expect(payload.refusal).toMatchObject({ code: 'UNAUTHORIZED_PLAN_CHANGE' });

    // (3) PENDING
    expect(typeof payload.pendingRequestId).toBe('string');
    expect(String(payload.pendingRequestId).length).toBeGreaterThan(0);

    // (2) LOGGED — an authority.change_refused event now exists
    const refusals = store.events().filter((e) => e.type === 'authority.change_refused');
    expect(refusals.length).toBeGreaterThan(0);
    expect(store.log.length).toBeGreaterThan(before);

    // and the refusal is a SUCCESSFUL result, not an error
    const requestId = String(payload.pendingRequestId);
    expect(refusals.some((e) => (e.payload as { requestId: string }).requestId === requestId)).toBe(true);
  });

  it('applies for a full-authority caregiver instead of refusing', () => {
    const result = requestRegimenChange(
      {
        ...guestContext(store, AS_OF, PERSON_ID),
        identity: resolveIdentity('Bearer demo-priya'),
      },
      { medicationId: 'med-acetaminophen', newFrequency: 4, reason: 'titrating' },
    );
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.status).toBe('applied');
    expect(payload.refusal).toBeUndefined();
  });

  it('record_dose never refuses, even for a role-none actor', () => {
    const result = recordDose(
      { ...guestContext(store, AS_OF, PERSON_ID), identity: GUEST },
      { medicationId: 'med-acetaminophen', amount: 500 },
    );
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { recorded: boolean }).recorded).toBe(true);
  });
});

describe('P3-5 · get_handoff is only settled when nothing is outstanding', () => {
  it('returns settled:false with unresolved items for the fixture', async () => {
    await withServer(async (client) => {
      const payload = structured(
        await call(client, 'get_handoff', { personId: PERSON_ID, toCaregiverId: 'caregiver-priya' }),
      );
      expect(payload.settled).toBe(false);
      expect((payload.unresolved as unknown[]).length).toBe(3);
      for (const item of payload.unresolved as { blocking: boolean; whoMustResolve: string }[]) {
        expect(item.whoMustResolve).toBeTruthy();
        expect(typeof item.blocking).toBe('boolean');
      }
      expect(String(payload.situation)).toMatch(/Robert/);
      expect(String(payload.assessment)).toMatch(/unresolved/i);
    });
  });

  it('flags the critical item as blocking', async () => {
    await withServer(async (client) => {
      const payload = structured(
        await call(client, 'get_handoff', { personId: PERSON_ID, toCaregiverId: 'caregiver-priya' }),
      );
      const blocking = (payload.unresolved as { blocking: boolean }[]).filter((u) => u.blocking);
      expect(blocking.length).toBeGreaterThan(0);
    });
  });
});

describe('DoD #4b · resolve_request closes the loop request_regimen_change opens', () => {
  const asPriya = () => ({
    ...guestContext(store, AS_OF, PERSON_ID),
    identity: resolveIdentity('Bearer demo-priya'),
  });

  /** Tom (role record) asks for a change: refused, logged, and left pending. */
  function askAsTom(): string {
    const result = requestRegimenChange(
      {
        ...guestContext(store, AS_OF, PERSON_ID),
        identity: resolveIdentity('Bearer demo-tom'),
      },
      { medicationId: 'med-acetaminophen', newFrequency: 4, reason: 'more pain' },
    );
    const payload = result.structuredContent as { pendingRequestId?: string };
    expect(payload.pendingRequestId, 'the ask must leave a pending request').toBeTruthy();
    return String(payload.pendingRequestId);
  }

  it('a full-authority caregiver approving writes authority.change_applied', () => {
    const requestId = askAsTom();
    const before = store.log.length;

    const result = resolveRequest(asPriya(), { requestId, decision: 'approve' });
    const payload = result.structuredContent as {
      status: string;
      eventId: string;
      message: string;
    };

    expect(result.isError).toBeFalsy();
    expect(payload.status).toBe('approved');
    expect(payload.message).toContain('Approved and recorded');
    expect(store.log.length).toBe(before + 1);

    const written = store.events().find((e) => e.eventId === payload.eventId);
    expect(written?.type).toBe('authority.change_applied');
    expect(written?.actorId).toBe('caregiver-priya');
    expect((written?.payload as { requestId: string }).requestId).toBe(requestId);
  });

  it('approval closes the R5 item for that request; the refusal stays in the log', () => {
    const requestId = askAsTom();
    const openItems = () =>
      allRuleHits(store.careState(), AS_OF).filter((h) => h.groupKey === `request:${requestId}`);

    expect(openItems().length).toBe(1);
    resolveRequest(asPriya(), { requestId, decision: 'approve' });
    expect(openItems().length).toBe(0);
    // The refusal itself is never deleted — the audit keeps both sides.
    expect(store.events().some((e) => e.type === 'authority.change_refused')).toBe(true);
  });

  it('declining records the decision, settles the request, and leaves the regimen alone', () => {
    const requestId = askAsTom();
    const plan = () => store.careState().medications.get('med-acetaminophen')!.frequencyHours.value;
    const planBefore = plan();

    const result = resolveRequest(asPriya(), {
      requestId,
      decision: 'decline',
      note: 'not on the pharmacist plan',
    });
    const payload = result.structuredContent as {
      status: string;
      eventId: string;
      message: string;
    };

    expect(payload.status).toBe('declined');
    expect(payload.message).toContain('stays as it is');

    const written = store.events().find((e) => e.eventId === payload.eventId);
    expect(written?.type).toBe('authority.change_declined');
    expect((written?.payload as { reason?: string }).reason).toBe('not on the pharmacist plan');

    expect(plan()).toBe(planBefore);
    expect(
      allRuleHits(store.careState(), AS_OF).filter((h) => h.groupKey === `request:${requestId}`),
    ).toHaveLength(0);
  });

  it('refuses a caller below full authority — successfully, and writes NOTHING', () => {
    const requestId = askAsTom();
    const before = store.log.length;

    const result = resolveRequest(
      { ...guestContext(store, AS_OF, PERSON_ID), identity: GUEST },
      { requestId, decision: 'approve' },
    );
    const payload = result.structuredContent as {
      status: string;
      refusal?: { code: string; whoCan: string };
      message: string;
    };

    // A refusal is a SUCCESSFUL result, never an error (PRD §6.4).
    expect(result.isError).toBeFalsy();
    expect(payload.status).toBe('refused');
    expect(payload.refusal).toMatchObject({
      code: 'UNAUTHORIZED_PLAN_CHANGE',
      whoCan: 'full-authority caregiver',
    });
    expect(payload.message).toContain('stays pending');
    expect(store.log.length).toBe(before);
  });

  it('answers a second decision instead of applying one twice', () => {
    const requestId = askAsTom();
    resolveRequest(asPriya(), { requestId, decision: 'approve' });
    const afterFirst = store.log.length;

    const second = resolveRequest(asPriya(), { requestId, decision: 'decline' });
    const payload = second.structuredContent as {
      status: string;
      decidedAs: string;
      eventId: string;
    };

    expect(second.isError).toBeFalsy();
    expect(payload.status).toBe('already_decided');
    expect(payload.decidedAs).toBe('approved');
    expect(payload.eventId).toBeTruthy();
    expect(store.log.length).toBe(afterFirst);
  });

  it('rejects an unknown request with a structured error', () => {
    const result = resolveRequest(asPriya(), {
      requestId: 'req-does-not-exist',
      decision: 'approve',
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'UNKNOWN_REQUEST' });
  });

  it('get_handoff lists the request while pending and drops it once settled', async () => {
    const requestId = askAsTom();
    await withServer(async (client) => {
      const pending = async () =>
        structured(
          await call(client, 'get_handoff', {
            personId: PERSON_ID,
            toCaregiverId: 'caregiver-priya',
          }),
        ).pendingRequests as { requestId: string; requesterName: string }[];

      const before = await pending();
      const mine = before.find((p) => p.requestId === requestId);
      expect(mine, 'the pending request must be offered to the caregiver').toBeTruthy();
      expect(mine!.requesterName).toBe('Tom');

      resolveRequest(asPriya(), { requestId, decision: 'approve' });
      expect((await pending()).some((p) => p.requestId === requestId)).toBe(false);
    });
  });
});

describe('P3-2 · read tools', () => {
  it('get_current_regimen lists medications with provenance', async () => {
    await withServer(async (client) => {
      const payload = structured(await call(client, 'get_current_regimen', { personId: PERSON_ID }));
      const meds = payload.medications as { id: string; status: string; provenance: unknown[] }[];
      expect(meds.map((m) => m.id).sort()).toEqual(['med-acetaminophen', 'med-ibuprofen']);
      for (const med of meds) {
        expect(med.provenance.length).toBeGreaterThan(0);
      }
      expect(meds.find((m) => m.id === 'med-ibuprofen')!.status).toBe('discontinued');
    });
  });

  it('get_timeline filters to the audit log with authority.*', async () => {
    await withServer(async (client) => {
      const payload = structured(
        await call(client, 'get_timeline', { personId: PERSON_ID, type: 'authority.*' }),
      );
      const events = payload.events as { type: string }[];
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.type.startsWith('authority.'))).toBe(true);
    });
  });

  it('get_timeline filters by actorId (read-only filter, plan D12)', async () => {
    await withServer(async (client) => {
      const payload = structured(
        await call(client, 'get_timeline', { personId: PERSON_ID, actorId: 'caregiver-tom' }),
      );
      const events = payload.events as { actorId: string }[];
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.actorId === 'caregiver-tom')).toBe(true);
    });
  });

  it('explain_problem resolves a real finding and returns its events', async () => {
    await withServer(async (client) => {
      const found = structured(await call(client, 'find_problems', { personId: PERSON_ID }));
      const findingId = (found.findings as { findingId: string }[])[0]!.findingId;
      const payload = structured(await call(client, 'explain_problem', { findingId }));
      expect((payload.rules as string[]).length).toBeGreaterThan(0);
      expect((payload.derivation as string[]).length).toBeGreaterThan(0);
      expect((payload.events as unknown[]).length).toBeGreaterThan(0);
    });
  });

  it('explain_problem rejects an unknown finding with a structured error', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'explain_problem', { findingId: 'f-nope' });
      expect(result.isError).toBe(true);
      expect(structured(result)).toMatchObject({ code: 'UNKNOWN_FINDING' });
    });
  });
});

describe('an assistant can use the read tools without knowing an internal id', () => {
  it('defaults personId to the person the record is about', async () => {
    await withServer(async (client) => {
      const bare = structured(await call(client, 'find_problems', {}));
      const explicit = structured(await call(client, 'find_problems', { personId: PERSON_ID }));
      expect(bare).toEqual(explicit);
      expect((bare.findings as unknown[]).length).toBe(3);
    });
  });

  it('every read tool answers with personId omitted', async () => {
    await withServer(async (client) => {
      const regimen = structured(await call(client, 'get_current_regimen', {}));
      expect((regimen.medications as unknown[]).length).toBe(2);

      const timeline = structured(await call(client, 'get_timeline', { type: 'authority.*' }));
      expect((timeline.events as unknown[]).length).toBeGreaterThan(0);

      const handoff = structured(
        await call(client, 'get_handoff', { toCaregiverId: 'caregiver-priya' }),
      );
      expect(handoff.settled).toBe(false);
    });
  });

  it('an explicit id that is not this person is a domain error, not an empty answer', async () => {
    await withServer(async (client) => {
      const result = await call(client, 'find_problems', { personId: 'person-nobody' });
      // The failure mode this guards: a typo must never come back as
      // NONE_FOUND_IN_RECORD, which would read as "nothing is wrong".
      expect(result.isError).toBe(true);
      const payload = structured(result);
      expect(payload).toMatchObject({ code: 'UNKNOWN_PERSON' });
      expect(String(payload.message)).toContain(PERSON_ID);
      expect((payload.suggestedFollowUp as string[]).join(' ')).toContain('Omit personId');
    });
  });
});