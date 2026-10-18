/**
 * Process-wide state: the append-only log plus a fold cache over it.
 *
 * One instance per process. The cache is invalidated on every append, which is
 * the only thing that can change the fold (Phase 1, P1-4).
 */
import { FoldCache, type CareState } from './fold.js';
import type { EventLog, NewEventInput } from './log.js';
import type { CareEvent } from './schemas/events.js';

export class Store {
  readonly log: EventLog;
  #cache: FoldCache;

  constructor(log: EventLog) {
    this.log = log;
    this.#cache = new FoldCache(log.all());
  }

  /** Cached. Never call the fold directly for tool code. */
  careState(): CareState {
    return this.#cache.get();
  }

  events(): readonly CareEvent[] {
    return this.log.all();
  }

  append(inputs: NewEventInput[]): CareEvent[] {
    const written = this.log.append(inputs);
    if (written.length > 0) this.#cache.invalidate(this.log.all());
    return written;
  }
}