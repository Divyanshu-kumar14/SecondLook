/**
 * `fold(events) -> CareState` (Phase 1, task P1-4).
 *
 * PRD §6.6 PROVENANCE RULE: every CareState field carries
 * `{value, eventId, actorId, ts, source}`. The server never emits an unsourced
 * claim — the model phrases, we prove.
 *
 * Performance: a single pass with Map lookups (no array scans). Budget is a
 * cold fold over ~300 events in under 25 ms; `tests/fold.test.ts` asserts it.
 */
import type { CareEvent, Role, Source } from './schemas/events.js';
// Only the types still referenced by name. The per-case payloads do NOT need
// casting — `CareEvent` is an intersection of a discriminated union with the
// envelope, so narrowing on `event.type` already types `event.payload`.
import type {
  AuthorityChangeApplied,
  AuthorityChangeDeclined,
  AuthorityChangeRefused,
  AuthorityChangeRequested,
  DocumentAttached,
  DoseMissed,
  ObservationRecorded,
  PersonRegistered,
  PlanConstraintSet,
} from './schemas/events.js';

export interface Provenance {
  eventId: string;
  actorId: string;
  /** Resolved server-side at write time (PRD §5.4). R6 reads this. */
  actorRole: Role;
  ts: string;
  source: Source;
}

/** A value plus where it came from. Never emit a bare value. */
export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}

function prov(event: CareEvent): Provenance {
  return {
    eventId: event.eventId,
    actorId: event.actorId,
    actorRole: event.actorRole,
    ts: event.ts,
    source: event.source,
  };
}

function sourced<T>(event: CareEvent, value: T): Sourced<T> {
  return { value, provenance: prov(event) };
}

export type MedicationStatus = 'active' | 'discontinued';

export interface MedicationState {
  id: string;
  personId: string;
  name: Sourced<string>;
  doseMg: Sourced<number>;
  form: Sourced<string>;
  frequencyHours: Sourced<number>;
  maxDailyMg?: Sourced<number>;
  status: Sourced<MedicationStatus>;
  /** Basis + whether the prescriber confirmed it (drives the §7 derived gap). */
  discontinuedBasis?: Sourced<string>;
  discontinuedPrescriberConfirmed?: Sourced<boolean>;
  prescribedAt: Provenance;
}

export interface CaregiverState {
  id: string;
  name: Sourced<string>;
  role: Sourced<string>;
  active: Sourced<boolean>;
}

export interface Dispensation {
  eventId: string;
  medicationId: string;
  doseMg: number;
  form: string;
  ts: string;
  provenance: Provenance;
}

export interface DoseRecord {
  eventId: string;
  medicationId: string;
  amountMg: number;
  ts: string;
  provenance: Provenance;
}

export type EventRef = { eventId: string; ts: string; source: Source };

/** Change requests / refusals / applied changes keep their event identity. */
export type WithEventRef<T> = T & EventRef;

export interface CareState {
  person?: Sourced<PersonRegistered>;
  caregivers: Map<string, CaregiverState>;
  medications: Map<string, MedicationState>;
  planConstraints: Sourced<PlanConstraintSet>;
  dispensations: Dispensation[];
  doses: DoseRecord[];
  missedDoses: Array<DoseMissed & EventRef>;
  observations: Array<ObservationRecorded & EventRef>;
  documents: Array<DocumentAttached & EventRef>;
  changeRequests: Map<string, WithEventRef<AuthorityChangeRequested>>;
  refusals: Map<string, WithEventRef<AuthorityChangeRefused>>;
  appliedChanges: Map<string, WithEventRef<AuthorityChangeApplied>>;
  /** Requests an authorised caregiver declined — settled, without applying. */
  declinedChanges: Map<string, WithEventRef<AuthorityChangeDeclined>>;
  acknowledgedProblems: Set<string>;
  /** Index of last event folded, used for cache invalidation. */
  foldedThrough: number;
}

export function emptyCareState(): CareState {
  return {
    caregivers: new Map(),
    medications: new Map(),
    planConstraints: sourced({} as CareEvent, {
      personId: '',
      barredClasses: [],
      reason: 'no plan constraint recorded',
    }),
    dispensations: [],
    doses: [],
    missedDoses: [],
    observations: [],
    documents: [],
    changeRequests: new Map(),
    refusals: new Map(),
    appliedChanges: new Map(),
    declinedChanges: new Map(),
    acknowledgedProblems: new Set(),
    foldedThrough: -1,
  };
}

/**
 * PURE. Same events in => byte-identical CareState out. No `Date.now()`, no I/O.
 */
export function fold(events: readonly CareEvent[]): CareState {
  const state = emptyCareState();

  for (const event of events) {
    switch (event.type) {
      case 'person.registered': {
        const p = event.payload;
        state.person = sourced(event, p);
        break;
      }

      case 'caregiver.joined': {
        const p = event.payload;
        state.caregivers.set(p.caregiverId, {
          id: p.caregiverId,
          name: sourced(event, p.name),
          role: sourced(event, p.role),
          active: sourced(event, true),
        });
        break;
      }

      case 'caregiver.left': {
        const existing = state.caregivers.get(event.payload.caregiverId);
        if (existing) existing.active = sourced(event, false);
        break;
      }

      case 'caregiver.authority_changed': {
        const p = event.payload;
        const existing = state.caregivers.get(p.caregiverId);
        if (existing) existing.role = sourced(event, p.to);
        break;
      }

      case 'plan.constraint_set': {
        state.planConstraints = sourced(event, event.payload);
        break;
      }

      case 'med.prescribed': {
        const p = event.payload;
        state.medications.set(p.medicationId, {
          id: p.medicationId,
          personId: p.personId,
          name: sourced(event, p.name),
          doseMg: sourced(event, p.doseMg),
          form: sourced(event, p.form),
          frequencyHours: sourced(event, p.frequencyHours),
          ...(p.maxDailyMg === undefined ? {} : { maxDailyMg: sourced(event, p.maxDailyMg) }),
          status: sourced(event, 'active'),
          prescribedAt: prov(event),
        });
        break;
      }

      case 'med.changed': {
        const p = event.payload;
        const med = state.medications.get(p.medicationId);
        if (med) {
          med.doseMg = sourced(event, p.doseMg);
          med.form = sourced(event, p.form);
          med.frequencyHours = sourced(event, p.frequencyHours);
          if (p.maxDailyMg !== undefined) med.maxDailyMg = sourced(event, p.maxDailyMg);
        }
        break;
      }

      case 'med.discontinued': {
        const p = event.payload;
        const med = state.medications.get(p.medicationId);
        if (med) {
          med.status = sourced(event, 'discontinued');
          med.discontinuedBasis = sourced(event, p.basis);
          med.discontinuedPrescriberConfirmed = sourced(event, p.prescriberConfirmed);
        }
        break;
      }

      case 'med.dispensed': {
        const p = event.payload;
        state.dispensations.push({
          eventId: event.eventId,
          medicationId: p.medicationId,
          doseMg: p.doseMg,
          form: p.form,
          ts: event.ts,
          provenance: prov(event),
        });
        break;
      }

      case 'dose.recorded': {
        const p = event.payload;
        state.doses.push({
          eventId: event.eventId,
          medicationId: p.medicationId,
          amountMg: p.amountMg,
          ts: event.ts,
          provenance: prov(event),
        });
        break;
      }

      case 'dose.missed': {
        state.missedDoses.push({
          ...event.payload,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'observation.recorded': {
        state.observations.push({
          ...event.payload,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'authority.change_requested': {
        const p = event.payload;
        // Event id + ts + source are retained so R5 can cite real evidence.
        state.changeRequests.set(p.requestId, {
          ...p,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'authority.change_refused': {
        const p = event.payload;
        state.refusals.set(p.requestId, {
          ...p,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'authority.change_applied': {
        const p = event.payload;
        state.appliedChanges.set(p.requestId, {
          ...p,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'authority.change_declined': {
        const p = event.payload;
        state.declinedChanges.set(p.requestId, {
          ...p,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'document.attached': {
        state.documents.push({
          ...event.payload,
          eventId: event.eventId,
          ts: event.ts,
          source: event.source,
        });
        break;
      }

      case 'problem.acknowledged': {
        const p = event.payload;
        state.acknowledgedProblems.add(p.findingId);
        break;
      }

      default: {
        // Exhaustiveness guard: adding a 19th event type breaks the build here
        // rather than silently dropping data at runtime.
        const unhandled: never = event;
        throw new Error(`Unhandled event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  state.foldedThrough = events.length - 1;
  return state;
}

/**
 * Cache wrapper. Invalidated by append count, which is the only thing that can
 * change the fold. Keeps `find_problems` off the hot path.
 */
export class FoldCache {
  #events: readonly CareEvent[];
  #cached?: CareState;

  constructor(events: readonly CareEvent[]) {
    this.#events = events;
  }

  /** Replace the event array after an append; drops the cached fold. */
  invalidate(events: readonly CareEvent[]): void {
    this.#events = events;
    this.#cached = undefined;
  }

  get(): CareState {
    this.#cached ??= fold(this.#events);
    return this.#cached;
  }
}