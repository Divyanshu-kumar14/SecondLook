import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fold, FoldCache, type CareState } from '../server/fold.js';
import { EventLog, type NewEventInput } from '../server/log.js';
import { buildScenario, AS_OF, PERSON_ID } from '../fixtures/scenario.js';

function scenarioState(): CareState {
  const log = EventLog.open('/tmp/opencode/fold-test.jsonl', 'demo');
  const written = log.append(buildScenario());
  return fold(written);
}

describe('P1-4 · fold produces a provenance-bearing CareState', () => {
  it('folds the person, the three personas and the plan constraint', () => {
    const state = scenarioState();
    expect(state.person?.value.name).toBe('Robert Alvarez');
    expect(state.person?.value.personId).toBe(PERSON_ID);
    expect([...state.caregivers.keys()].sort()).toEqual([
      'caregiver-elena',
      'caregiver-priya',
      'caregiver-tom',
    ]);
    expect(state.planConstraints.value.barredClasses).toEqual(['NSAID']);
    expect(state.planConstraints.value.reason).toBe('CKD stage 3');
  });

  it('records roles as sourced values, not bare strings', () => {
    const state = scenarioState();
    const priya = state.caregivers.get('caregiver-priya')!;
    expect(priya.role.value).toBe('full');
    expect(priya.role.provenance.actorId).toBe('system:seed');
    expect(priya.role.provenance.source).toBe('clinician');
    expect(priya.active.value).toBe(true);
  });

  it('marks ibuprofen discontinued and keeps the unconfirmed basis (the §7 derived gap)', () => {
    const state = scenarioState();
    const ibu = state.medications.get('med-ibuprofen')!;
    expect(ibu.status.value).toBe('discontinued');
    expect(ibu.discontinuedBasis?.value).toBe('pharmacist call');
    expect(ibu.discontinuedPrescriberConfirmed?.value).toBe(false);
    expect(ibu.status.provenance.source).toBe('pharmacy');
    expect(ibu.status.provenance.actorId).toBe('caregiver-priya');
  });

  it('collects doses, the Day 7 dispense mismatch and the refusal', () => {
    const state = scenarioState();
    expect(state.doses).toHaveLength(4);
    expect(state.doses.filter((d) => d.medicationId === 'med-ibuprofen')).toHaveLength(2);
    expect(state.dispensations).toHaveLength(1);
    expect(state.dispensations[0]).toMatchObject({ doseMg: 650, form: 'ER' });
    expect(state.refusals.get('req-elena-acetaminophen-q4h')).toMatchObject({
      requesterId: 'caregiver-elena',
      requesterRole: 'none',
    });
  });

  it('attaches provenance to EVERY field, per the PRD §6.6 rule', () => {
    const state = scenarioState();
    const med = state.medications.get('med-acetaminophen')!;
    for (const field of [med.name, med.doseMg, med.form, med.frequencyHours, med.status, med.maxDailyMg!]) {
      expect(field.provenance.eventId, 'every field must name its event').toMatch(/^[0-9a-f-]{36}$/);
      expect(field.provenance.actorId).toBeTruthy();
      expect(field.provenance.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    for (const dose of state.doses) {
      expect(dose.provenance.eventId).toBeTruthy();
      expect(dose.provenance.source).toBe('caregiver');
    }
  });

  it('uses one actorId per dose so R6 can see Elena recorded one', () => {
    const state = scenarioState();
    expect(state.doses.filter((d) => d.provenance.actorId === 'caregiver-elena')).toHaveLength(1);
  });

  it('returns an empty, usable state for an empty log', () => {
    const state = fold([]);
    expect(state.person).toBeUndefined();
    expect(state.medications.size).toBe(0);
    expect(state.foldedThrough).toBe(-1);
    expect(state.planConstraints.value.reason).toBe('no plan constraint recorded');
  });
});

describe('P1-4 · determinism and cache', () => {
  it('produces byte-identical output for the same events', () => {
    expect(JSON.stringify(scenarioState())).toBe(JSON.stringify(scenarioState()));
  });

  it('cold-folds ~300 events in under 25 ms', () => {
    const log = EventLog.open('/tmp/opencode/fold-perf.jsonl', 'demo');
    const base: NewEventInput[] = [
      {
        type: 'person.registered',
        payload: { personId: 'p1', name: 'Perf', ageYears: 70, condition: 'x' },
        actorId: 'system:seed',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-11T08:00:00.000Z',
      },
    ];
    const doses: NewEventInput[] = Array.from({ length: 300 }, (_, i) => ({
      type: 'dose.recorded' as const,
      payload: { personId: 'p1', medicationId: `m${i % 5}`, amountMg: 500 },
      actorId: `caregiver-${i % 3}`,
      actorRole: 'record' as const,
      source: 'caregiver' as const,
      ts: new Date(Date.UTC(2026, 9, 11, 0, i)).toISOString(),
    }));
    const events = log.append([...base, ...doses]);
    expect(events.length).toBe(301);

    const started = performance.now();
    const state = fold(events);
    const elapsed = performance.now() - started;

    expect(state.doses).toHaveLength(300);
    expect(elapsed, `cold fold took ${elapsed.toFixed(2)} ms`).toBeLessThan(25);
  });

  it('caches the fold and drops it on invalidate', () => {
    const log = EventLog.open('/tmp/opencode/fold-cache.jsonl', 'demo');
    const written = log.append(buildScenario());
    const cache = new FoldCache(written);

    const first = cache.get();
    expect(cache.get()).toBe(first); // same reference => cached

    const appended = log.append([]);
    cache.invalidate(log.all());
    expect(cache.get()).not.toBe(first);
    expect(cache.get().doses).toHaveLength(4);
    expect(appended).toHaveLength(0);
  });
});

describe('P1-4 · the event types the §7 fixture does not produce', () => {
  function logWith(inputs: NewEventInput[]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'sl-fold-extra-'));
    const log = EventLog.open(path.join(dir, 'events.jsonl'), 'demo');
    return { log, events: log.append(inputs) };
  }

  const base = {
    person: {
      type: 'person.registered' as const,
      payload: { personId: 'p1', name: 'X', ageYears: 70, condition: 'c' },
      actorId: 'system:seed',
      actorRole: 'full' as const,
      source: 'clinician' as const,
      ts: '2026-10-11T08:00:00.000Z',
    },
    joinPriya: {
      type: 'caregiver.joined' as const,
      payload: { caregiverId: 'caregiver-priya', name: 'Priya', role: 'full' as const },
      actorId: 'system:seed',
      actorRole: 'full' as const,
      source: 'clinician' as const,
      ts: '2026-10-11T08:01:00.000Z',
    },
    med: {
      type: 'med.prescribed' as const,
      payload: {
        personId: 'p1',
        medicationId: 'm1',
        name: 'ibuprofen',
        doseMg: 800,
        form: 'IR',
        frequencyHours: 6,
      },
      actorId: 'system:seed',
      actorRole: 'full' as const,
      source: 'document' as const,
      ts: '2026-10-11T08:02:00.000Z',
    },
  };

  it('folds caregiver.left and marks the caregiver inactive', () => {
    const { events } = logWith([
      base.person,
      base.joinPriya,
      {
        type: 'caregiver.left',
        payload: { caregiverId: 'caregiver-priya' },
        actorId: 'system:seed',
        actorRole: 'full',
        source: 'caregiver',
        ts: '2026-10-12T09:00:00.000Z',
      },
    ]);
    const state = fold(events);
    expect(state.caregivers.get('caregiver-priya')!.active.value).toBe(false);
  });

  it('ignores caregiver.left and authority_changed for an unknown caregiver', () => {
    // Defensive branch: history can legitimately reference someone not joined.
    const { events } = logWith([
      base.person,
      {
        type: 'caregiver.left',
        payload: { caregiverId: 'ghost' },
        actorId: 'system:seed',
        actorRole: 'full',
        source: 'caregiver',
        ts: '2026-10-12T09:00:00.000Z',
      },
      {
        type: 'caregiver.authority_changed',
        payload: { caregiverId: 'ghost', from: 'record', to: 'full' },
        actorId: 'system:seed',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-12T09:01:00.000Z',
      },
    ]);
    expect(fold(events).caregivers.size).toBe(0);
  });

  it('folds caregiver.authority_changed onto an existing role', () => {
    const { events } = logWith([
      base.person,
      base.joinPriya,
      {
        type: 'caregiver.authority_changed',
        payload: { caregiverId: 'caregiver-priya', from: 'full', to: 'record' },
        actorId: 'system:seed',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-12T09:00:00.000Z',
      },
    ]);
    const state = fold(events);
    expect(state.caregivers.get('caregiver-priya')!.role.value).toBe('record');
  });

  it('folds med.changed, replacing dose/form/frequency and adding maxDailyMg', () => {
    const { events } = logWith([
      base.person,
      base.med,
      {
        type: 'med.changed',
        payload: {
          personId: 'p1',
          medicationId: 'm1',
          name: 'ibuprofen',
          doseMg: 400,
          form: 'ER',
          frequencyHours: 12,
          maxDailyMg: 1200,
          basis: 'titration',
          prescriberConfirmed: true,
        },
        actorId: 'caregiver-priya',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-13T09:00:00.000Z',
      },
    ]);
    const med = fold(events).medications.get('m1')!;
    expect(med.doseMg.value).toBe(400);
    expect(med.form.value).toBe('ER');
    expect(med.frequencyHours.value).toBe(12);
    expect(med.maxDailyMg!.value).toBe(1200);
    expect(med.maxDailyMg!.provenance.actorId).toBe('caregiver-priya');
  });

  it('folds med.changed without maxDailyMg, leaving the prior cap untouched', () => {
    const { events } = logWith([
      base.person,
      {
        ...base.med,
        payload: { ...base.med.payload, maxDailyMg: 2400 },
      },
      {
        type: 'med.changed',
        payload: {
          personId: 'p1',
          medicationId: 'm1',
          name: 'ibuprofen',
          doseMg: 400,
          form: 'IR',
          frequencyHours: 12,
          basis: 'titration',
          prescriberConfirmed: true,
        },
        actorId: 'caregiver-priya',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-13T09:00:00.000Z',
      },
    ]);
    expect(fold(events).medications.get('m1')!.maxDailyMg!.value).toBe(2400);
  });

  it('ignores med.changed and med.discontinued for an unknown medication', () => {
    const { events } = logWith([
      base.person,
      {
        type: 'med.changed',
        payload: {
          personId: 'p1',
          medicationId: 'ghost',
          name: 'x',
          doseMg: 1,
          form: 'IR',
          frequencyHours: 1,
          basis: 'b',
          prescriberConfirmed: true,
        },
        actorId: 'caregiver-priya',
        actorRole: 'full',
        source: 'clinician',
        ts: '2026-10-13T09:00:00.000Z',
      },
      {
        type: 'med.discontinued',
        payload: { personId: 'p1', medicationId: 'ghost', basis: 'b', prescriberConfirmed: true },
        actorId: 'caregiver-priya',
        actorRole: 'full',
        source: 'pharmacy',
        ts: '2026-10-13T09:01:00.000Z',
      },
    ]);
    expect(fold(events).medications.size).toBe(0);
  });

  it('collects dose.missed entries', () => {
    const { events } = logWith([
      base.person,
      {
        type: 'dose.missed',
        payload: { personId: 'p1', medicationId: 'm1', scheduledAt: '2026-10-17T08:00:00.000Z' },
        actorId: 'caregiver-tom',
        actorRole: 'record',
        source: 'caregiver',
        ts: '2026-10-17T09:00:00.000Z',
      },
    ]);
    expect(fold(events).missedDoses).toEqual([
      { personId: 'p1', medicationId: 'm1', scheduledAt: '2026-10-17T08:00:00.000Z' },
    ]);
  });
});

describe('P1-9 · the frozen demo clock', () => {
  it('pins asOf to Day 8 18:00 and never reads the wall clock', () => {
    expect(AS_OF).toBe('2026-10-18T18:00:00.000Z');
    const state = scenarioState();
    // Every scenario event must sit at or before the demo clock.
    for (const dose of state.doses) {
      expect(new Date(dose.ts).getTime()).toBeLessThanOrEqual(new Date(AS_OF).getTime());
    }
  });
});