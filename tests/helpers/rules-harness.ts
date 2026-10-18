/**
 * Test harness for rule tests (Phase 2, task P2-1).
 *
 * Builds a real CareState by folding real events through the real log, so rule
 * tests exercise the same path production does rather than a hand-built mock.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fold, type CareState } from '../../server/fold.js';
import { EventLog, type NewEventInput } from '../../server/log.js';

let counter = 0;

/** Deterministic timestamp helper: day offset from 2026-10-11, then HH:MM. */
export function at(day: number, time = '08:00'): string {
  return new Date(Date.UTC(2026, 9, 11 + day, ...(time.split(':').map(Number) as [number, number, number])))
    .toISOString();
}

export function newLog(): EventLog {
  counter += 1;
  return EventLog.open(path.join(mkdtempSync(path.join(tmpdir(), `sl-rule-${counter}-`)), 'e.jsonl'), 'demo');
}

export function stateOf(events: NewEventInput[]): CareState {
  return fold(newLog().append(events));
}

// ── Baseline scaffolding ──────────────────────────────────────────────────────

export const PERSON = 'person-test';
export const MED_A = 'med-a';
export const MED_B = 'med-b';

export const personEvent: NewEventInput = {
  type: 'person.registered',
  payload: { personId: PERSON, name: 'Test Person', ageYears: 74, condition: 'CKD stage 3' },
  actorId: 'system:seed',
  actorRole: 'full',
  source: 'clinician',
  ts: at(0, '07:00'),
};

export function join(caregiverId: string, role: 'full' | 'record' | 'none'): NewEventInput {
  return {
    type: 'caregiver.joined',
    payload: { caregiverId, name: caregiverId, role },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'clinician',
    ts: at(0, '07:01'),
  };
}

export function prescribe(
  medicationId: string,
  name: string,
  overrides: Partial<{ doseMg: number; form: string; frequencyHours: number; maxDailyMg: number }> = {},
): NewEventInput {
  return {
    type: 'med.prescribed',
    payload: {
      personId: PERSON,
      medicationId,
      name,
      doseMg: overrides.doseMg ?? 500,
      form: overrides.form ?? 'IR',
      frequencyHours: overrides.frequencyHours ?? 6,
      ...(overrides.maxDailyMg === undefined ? {} : { maxDailyMg: overrides.maxDailyMg }),
    },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'document',
    ts: at(0, '07:10'),
  };
}

export function dose(
  medicationId: string,
  amountMg: number,
  day: number,
  time: string,
  actorId = 'caregiver-tom',
  actorRole: 'full' | 'record' | 'none' = 'record',
): NewEventInput {
  return {
    type: 'dose.recorded',
    payload: { personId: PERSON, medicationId, amountMg },
    actorId,
    actorRole,
    source: 'caregiver',
    ts: at(day, time),
  };
}

export function barClasses(classes: string[], reason = 'CKD stage 3'): NewEventInput {
  return {
    type: 'plan.constraint_set',
    payload: { personId: PERSON, barredClasses: classes, reason },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'clinician',
    ts: at(0, '07:05'),
  };
}

export const AS_OF = at(7, '18:00');