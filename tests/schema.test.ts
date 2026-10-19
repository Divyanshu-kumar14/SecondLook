import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertNoReferences, stripJsonSchemaMeta, toJsonSchema } from '../server/schema.js';
import {
  EVENT_TYPES,
  EventSchema,
  PAYLOAD_SCHEMAS,
  parsePayload,
} from '../server/schemas/events.js';
import {
  REFUSING_TOOLS,
  TOOL_CONTRACTS,
  TOOL_NAMES,
  WRITE_TOOLS,
} from '../server/schemas/tools.js';

describe('P0-3 · Zod 4 → JSON Schema (plan D2)', () => {
  it('strips top-level and nested $schema meta keys', () => {
    const raw = z.toJSONSchema(
      z.object({ nested: z.object({ inner: z.string() }), list: z.array(z.string()) }),
    );
    expect('$schema' in raw).toBe(true); // zod does emit it...

    const clean = toJsonSchema(z.object({ nested: z.object({ inner: z.string() }) }));
    expect('$schema' in clean).toBe(false); // ...and we remove it.
    expect(stripJsonSchemaMeta({ a: { $schema: 'x', b: 1 } })).toEqual({ a: { b: 1 } });
  });

  it('does not mutate its input', () => {
    const input = { $schema: 'x', keep: 1 };
    stripJsonSchemaMeta(input);
    expect(input).toEqual({ $schema: 'x', keep: 1 });
  });

  it('emits no $ref / $defs for a hostile schema (reused, union, record, discriminated)', () => {
    const Severity = z.enum(['low', 'critical']);
    const Evidence = z.object({ eventId: z.string() });
    const schema = toJsonSchema(
      z.object({
        severity: Severity,
        evidence: z.array(Evidence),
        when: z.union([z.string(), z.number()]),
        kind: z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), a: z.string() }),
          z.object({ type: z.literal('b'), b: z.number() }),
        ]),
        tags: z.record(z.string(), z.string()).optional(),
      }),
    );
    expect(() => assertNoReferences(schema)).not.toThrow();
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
  });

  it('assertNoReferences actually fails when a ref is present', () => {
    expect(() => assertNoReferences({ $defs: {} })).toThrow(/\$defs/);
  });
});

describe('P0-5 · shared event schemas', () => {
  it('declares exactly the 18 event types from PRD §6.2 plus the §8 addendum', () => {
    expect(EVENT_TYPES).toHaveLength(18);
    expect(new Set(EVENT_TYPES).size).toBe(18);
    expect(EVENT_TYPES).toContain('authority.change_refused');
    expect(EVENT_TYPES).toContain('authority.change_declined');
    expect(EVENT_TYPES).toContain('problem.acknowledged');
  });

  it('has a payload schema for every event type', () => {
    for (const type of EVENT_TYPES) {
      expect(PAYLOAD_SCHEMAS[type], `missing payload schema for ${type}`).toBeDefined();
    }
  });

  it('rejects a payload that violates its own type', () => {
    expect(() => parsePayload('dose.recorded', { personId: 'p1', medicationId: 'm1', amountMg: -5 })).toThrow();
    expect(parsePayload('dose.recorded', { personId: 'p1', medicationId: 'm1', amountMg: 500 })).toMatchObject({
      amountMg: 500,
    });
  });

  it('accepts a full envelope and rejects one missing hash fields', () => {
    const base = {
      eventId: 'e1',
      seq: 0,
      ts: '2026-10-18T12:00:00.000Z',
      actorId: 'system:seed',
      actorRole: 'full' as const,
      source: 'document' as const,
      prevHash: 'GENESIS',
      hash: 'abc',
    };
    const ok = EventSchema.safeParse({
      ...base,
      type: 'person.registered',
      payload: { personId: 'p1', name: 'Robert Alvarez', ageYears: 74, condition: 'CKD stage 3' },
    });
    expect(ok.success).toBe(true);

    const bad = EventSchema.safeParse({ ...base, type: 'person.registered', payload: { personId: 'p1' } });
    expect(bad.success).toBe(false);
  });
});

describe('P1-6 (front-loaded) · identity invariant', () => {
  it('declares exactly the 9 tools from PRD §8', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect(new Set(TOOL_NAMES).size).toBe(9);
  });

  it('no WRITE tool accepts an actorId that could forge identity', () => {
    for (const name of WRITE_TOOLS) {
      const shape = Object.keys((TOOL_CONTRACTS[name].input as z.ZodObject).shape);
      expect(shape, `${name} must not accept actorId`).not.toContain('actorId');
      expect(shape, `${name} must not accept actorRole`).not.toContain('actorRole');
    }
  });

  it('get_timeline is the ONLY tool with actorId, and it is read-only', () => {
    const withActorId = TOOL_NAMES.filter((n) =>
      Object.keys((TOOL_CONTRACTS[n].input as z.ZodObject).shape).includes('actorId'),
    );
    expect(withActorId).toEqual(['get_timeline']);
    expect(TOOL_CONTRACTS.get_timeline.mutates).toBe(false);
  });

  it('only the authority tools may refuse', () => {
    expect(REFUSING_TOOLS).toEqual(['request_regimen_change', 'resolve_request']);
    // record_dose must accept and flag, never refuse (PRD §6.4).
    expect(WRITE_TOOLS).toContain('record_dose');
    expect(REFUSING_TOOLS).not.toContain('record_dose');
    expect(REFUSING_TOOLS).not.toContain('check_dose');
  });
});