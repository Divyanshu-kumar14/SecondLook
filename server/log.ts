/**
 * Append-only JSONL event log with a SHA-256 hash chain.
 * Phase 1, tasks P1-1 / P1-2 / P1-3.
 *
 * INVARIANTS (PRD §6.1):
 *   • `seq` is monotonic and gaps are forbidden.
 *   • `hash = sha256(prevHash + canonicalJson(event without hash))`.
 *   • There is NO update and NO delete in the write API. Corrections are new
 *     superseding events (`supersedes`). Enforced structurally below, not by
 *     convention: `append()` is the only mutator and the events array is only
 *     ever frozen, never spliced.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  EventSchema,
  parsePayload,
  type CareEvent,
  type EventType,
  type Role,
  type Source,
} from './schemas/events.js';

/** `prevHash` of the very first event. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON: object keys sorted at every depth, no whitespace, and
 * `undefined` properties omitted. Two structurally equal values must always
 * serialise to byte-identical strings, or the chain is meaningless.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) continue; // omit, do not emit `null`
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

/** Everything except the hash itself. */
export type EventBodyForHash = Omit<CareEvent, 'hash'>;

export function computeHash(prevHash: string, body: EventBodyForHash): string {
  return createHash('sha256').update(prevHash + canonicalJson(body)).digest('hex');
}

export interface NewEventInput {
  type: EventType;
  payload: unknown;
  /** Resolved server-side from the bearer token (PRD §5.4). Never client input. */
  actorId: string;
  actorRole: Role;
  source: Source;
  ts: string;
  supersedes?: string;
  eventId?: string;
}

export interface VerifyResult {
  ok: boolean;
  count: number;
  /** Index of the first invalid event, or -1. */
  failedAt: number;
  reason?: string;
}

/** Deterministic UUIDv5-shaped id from a namespace + seed. No randomness. */
function deterministicId(namespace: string, seed: string): string {
  const h = createHash('sha256').update(`${namespace}:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class EventLog {
  readonly #file: string;
  #events: CareEvent[] = [];
  #frozen: readonly CareEvent[] = Object.freeze([]);

  private constructor(file: string) {
    this.#file = file;
  }

  /**
   * `mode: 'demo'` truncates and re-seeds the file (plan D4) so every judge run
   * and every recording is byte-identical. `mode: 'persist'` appends.
   */
  static open(file: string, mode: 'demo' | 'persist'): EventLog {
    const log = new EventLog(file);
    if (mode === 'demo') {
      const dir = path.dirname(file);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, '');
    } else if (!existsSync(file)) {
      const dir = path.dirname(file);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, '');
    } else {
      log.#load();
    }
    return log;
  }

  #load(): void {
    const raw = readFileSync(this.#file, 'utf8');
    const events: CareEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const parsed = EventSchema.safeParse(JSON.parse(trimmed));
      if (!parsed.success) {
        throw new Error(
          `Corrupt event log at line ${events.length + 1}: ${parsed.error.message}`,
        );
      }
      events.push(parsed.data);
    }
    this.#events = events;
    this.#frozen = Object.freeze([...events]);
  }

  /** Read-only snapshot. Frozen, so callers cannot mutate history. */
  all(): readonly CareEvent[] {
    return this.#frozen;
  }

  get length(): number {
    return this.#events.length;
  }

  /**
   * The ONLY write path. There is deliberately no `update`, `delete`, `patch`
   * or `remove` method — see `tests/log.test.ts`, which asserts their absence.
   */
  append(inputs: NewEventInput[]): CareEvent[] {
    if (inputs.length === 0) return [];

    const appended: CareEvent[] = [];
    let prevHash = this.#events.at(-1)?.hash ?? GENESIS_HASH;
    let seq = this.#events.length;

    for (const input of inputs) {
      // Validate the payload against its own event type BEFORE hashing, so an
      // invalid event can never enter the chain.
      const payload = parsePayload(input.type, input.payload);

      const body: EventBodyForHash = {
        eventId:
          input.eventId ??
          deterministicId('event', `${seq}:${input.type}:${input.ts}:${input.actorId}`),
        seq,
        ts: input.ts,
        actorId: input.actorId,
        actorRole: input.actorRole,
        type: input.type,
        payload,
        ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
        source: input.source,
        prevHash,
      };

      const event: CareEvent = EventSchema.parse({ ...body, hash: computeHash(prevHash, body) });
      appended.push(event);
      this.#events.push(event);
      prevHash = event.hash;
      seq += 1;
    }

    this.#frozen = Object.freeze([...this.#events]);
    appendFileSync(this.#file, appended.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    return appended;
  }

  /**
   * Recompute the whole chain. Returns the index of the first divergence, so
   * `npm run verify-log` can report *where* the log was tampered with.
   */
  verify(): VerifyResult {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < this.#events.length; i += 1) {
      const event = this.#events[i]!;
      if (event.seq !== i) {
        return { ok: false, count: this.#events.length, failedAt: i, reason: `seq gap: expected ${i}, got ${event.seq}` };
      }
      if (event.prevHash !== prevHash) {
        return { ok: false, count: this.#events.length, failedAt: i, reason: `prevHash mismatch: expected ${prevHash.slice(0, 12)}…, got ${event.prevHash.slice(0, 12)}…` };
      }
      const { hash, ...body } = event;
      const expected = computeHash(prevHash, body);
      if (expected !== hash) {
        return { ok: false, count: this.#events.length, failedAt: i, reason: `hash mismatch at event ${i}: expected ${expected.slice(0, 12)}…, got ${hash.slice(0, 12)}…` };
      }
      prevHash = hash;
    }
    return { ok: true, count: this.#events.length, failedAt: -1 };
  }
}

/** Open a log for the current process, honouring `SL_LOG_MODE` semantics. */
export function openLog(file: string, mode: 'demo' | 'persist'): EventLog {
  return EventLog.open(file, mode);
}