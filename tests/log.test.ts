import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, computeHash, EventLog, GENESIS_HASH, type NewEventInput } from '../server/log.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sl-log-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  // Temp dirs live under the OS tmp dir; left to the OS rather than rm -rf'd.
  void dir;
});

const dose = (amountMg: number, ts: string, actorId = 'caregiver-tom'): NewEventInput => ({
  type: 'dose.recorded',
  payload: { personId: 'p1', medicationId: 'm1', amountMg },
  actorId,
  actorRole: 'record',
  source: 'caregiver',
  ts,
});

describe('P1-1 · canonical JSON is stable', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is order-independent, which is what makes the chain meaningful', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('omits undefined properties instead of emitting null', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves array order, because order is semantic there', () => {
    expect(canonicalJson({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });
});

describe('P1-1/P1-2 · append-only hash chain', () => {
  it('links each event to the previous hash and starts at GENESIS', () => {
    const log = EventLog.open(file, 'demo');
    const [a, b, c] = log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z'), dose(500, '2026-10-17T08:00:00.000Z')]);

    expect(a!.prevHash).toBe(GENESIS_HASH);
    expect(b!.prevHash).toBe(a!.hash);
    expect(c!.prevHash).toBe(b!.hash);
    expect([a!.seq, b!.seq, c!.seq]).toEqual([0, 1, 2]);
    expect(log.verify()).toMatchObject({ ok: true, count: 3 });
  });

  it('hashes prevHash + canonicalJson(everything except hash)', () => {
    const log = EventLog.open(file, 'demo');
    const [a] = log.append([dose(500, '2026-10-16T08:00:00.000Z')]);
    const { hash, ...body } = a!;
    expect(hash).toBe(computeHash(GENESIS_HASH, body));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a payload that violates its own event type, before it is hashed', () => {
    const log = EventLog.open(file, 'demo');
    expect(() => log.append([{ ...dose(-5, '2026-10-16T08:00:00.000Z') }])).toThrow();
    expect(log.length, 'an invalid event must not enter the chain').toBe(0);
  });

  it('appends nothing for an empty input', () => {
    const log = EventLog.open(file, 'demo');
    expect(log.append([])).toEqual([]);
    expect(log.length).toBe(0);
  });

  it('hands out a frozen snapshot that callers cannot mutate', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z')]);
    expect(Object.isFrozen(log.all())).toBe(true);
    expect(() => {
      (log.all() as unknown as unknown[]).push({});
    }).toThrow();
  });

  it('exposes NO update, delete, patch or remove method (P1-2 structural check)', () => {
    const log = EventLog.open(file, 'demo');
    const proto = Object.getPrototypeOf(log) as object;
    const methods = new Set<string>([
      ...Object.getOwnPropertyNames(proto),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(proto) ?? {}),
    ]);
    for (const banned of ['update', 'delete', 'remove', 'patch', 'set', 'truncate']) {
      expect(methods.has(banned), `EventLog must not expose .${banned}()`).toBe(false);
    }
  });
});

describe('P1-3 · verify detects tampering', () => {
  it('passes on an untouched log', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z')]);
    expect(log.verify().ok).toBe(true);
  });

  it('fails and names the index when a payload byte is edited', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z')]);
    const raw = readFileSync(file, 'utf8').replace('"amountMg":500', '"amountMg":900');
    writeFileSync(file, raw);

    const reopened = EventLog.open(file, 'persist');
    const result = reopened.verify();
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('fails when an event is deleted from the middle', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z'), dose(500, '2026-10-17T08:00:00.000Z')]);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, lines.filter((_, i) => i !== 1).join('\n') + '\n');

    const result = EventLog.open(file, 'persist').verify();
    expect(result.ok).toBe(false);
  });

  it('refuses to load a structurally invalid line', () => {
    writeFileSync(file, '{"not":"an event"}\n');
    expect(() => EventLog.open(file, 'persist')).toThrow(/Corrupt event log/);
  });

  // F29. `EventSchema` is a Zod object and strips unknown keys, so hashing the
  // PARSED event let an injected field pass the chain untouched. This is the
  // test that was missing when the hole was found.
  it('fails when an unknown field is injected into a stored event', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z')]);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[1]!) as Record<string, unknown>;
    record['notes'] = 'TAMPERED';
    lines[1] = JSON.stringify(record);
    writeFileSync(file, lines.join('\n') + '\n');

    const result = EventLog.open(file, 'persist').verify();
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.reason).toMatch(/unexpected field\(s\).*notes/);
  });

  // Guards the fix against over-correcting: reordering keys changes no meaning
  // and no hash, so it must still verify clean.
  it('still passes when a stored event is re-serialised with reordered keys', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z')]);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[1]!) as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).reverse()) reordered[key] = record[key];
    lines[1] = JSON.stringify(reordered);
    writeFileSync(file, lines.join('\n') + '\n');

    expect(EventLog.open(file, 'persist').verify().ok).toBe(true);
  });

  // The chain links must be read from the stored record too, not from the
  // parsed copy — otherwise a rewritten `prevHash` would be compared against
  // the value the schema happened to accept.
  it('fails when prevHash is rewritten on a stored event', () => {
    const log = EventLog.open(file, 'demo');
    log.append([dose(500, '2026-10-16T08:00:00.000Z'), dose(500, '2026-10-16T12:00:00.000Z')]);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[1]!) as Record<string, unknown>;
    record['prevHash'] = GENESIS_HASH;
    lines[1] = JSON.stringify(record);
    writeFileSync(file, lines.join('\n') + '\n');

    const result = EventLog.open(file, 'persist').verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/prevHash mismatch/);
  });
});

describe('P1-1 determinism', () => {
  it('produces identical event ids for identical inputs', () => {
    const inputs = [dose(500, '2026-10-16T08:00:00.000Z'), dose(250, '2026-10-16T12:00:00.000Z')];
    const first = EventLog.open(path.join(dir, 'a.jsonl'), 'demo').append(inputs);
    const second = EventLog.open(path.join(dir, 'b.jsonl'), 'demo').append(inputs);
    expect(first.map((e) => e.eventId)).toEqual(second.map((e) => e.eventId));
    expect(first.map((e) => e.hash)).toEqual(second.map((e) => e.hash));
  });
});