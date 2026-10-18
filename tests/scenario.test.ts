import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../server/log.js';
import { seedDemoLog } from '../fixtures/seed.js';
import {
  ACKNOWLEDGEMENTS,
  AS_OF,
  buildAcknowledgements,
  buildScenario,
} from '../fixtures/scenario.js';
import { findingIdFor } from '../server/finding-id.js';
import { fold } from '../server/fold.js';
import { findProblems } from '../server/rules/index.js';

function seeded() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sl-seed-'));
  const file = path.join(dir, 'events.jsonl');
  const result = seedDemoLog(file);
  return { log: result.log, file, sha256: result.sha256 };
}

describe('P1-9 · deterministic seed', () => {
  it('produces a byte-identical log across separate runs', () => {
    expect(seeded().sha256).toBe(seeded().sha256);
  });

  it('produces a byte-identical log with the same event ids and hashes', () => {
    const a = seeded().log.all().map((e) => JSON.stringify(e));
    const b = seeded().log.all().map((e) => JSON.stringify(e));
    expect(a).toEqual(b);
  });

  it('emits a valid chain of 19 events with no seq gap', () => {
    const { log } = seeded();
    expect(log.verify()).toMatchObject({ ok: true });
    expect(log.length).toBe(19);
    log.all().forEach((event, index) => expect(event.seq).toBe(index));
  });

  it('reproduces the §7 shape: ibuprofen stopped on day 3, then given twice on day 5', () => {
    const state = fold(seeded().log.all());
    const ibu = state.medications.get('med-ibuprofen')!;
    expect(ibu.status.value).toBe('discontinued');
    expect(ibu.discontinuedPrescriberConfirmed?.value).toBe(false);
    const ibuDoses = state.doses.filter((d) => d.medicationId === 'med-ibuprofen');
    expect(ibuDoses.map((d) => d.provenance.actorId)).toEqual([
      'caregiver-tom',
      'caregiver-elena',
    ]);
  });

  it('has no dangling acknowledgement: every ack names a real finding', () => {
    const { log } = seeded();
    const state = fold(log.all());
    const findings = findProblems(state, AS_OF);
    expect(findings.length).toBeGreaterThan(0);
    for (const findingId of state.acknowledgedProblems) {
      expect(
        findings.some((f) => f.findingId === findingId),
        `acknowledged finding ${findingId} does not exist`,
      ).toBe(true);
    }
  });

  it('acknowledges exactly the planned findings, and they are marked acknowledged', () => {
    const { log } = seeded();
    const state = fold(log.all());
    expect(state.acknowledgedProblems.size).toBe(ACKNOWLEDGEMENTS.length);

    const findings = findProblems(state, AS_OF);
    for (const plan of ACKNOWLEDGEMENTS) {
      const finding = findings.find((f) => f.rules.includes(plan.requiresRule));
      expect(finding, `no finding for ${plan.requiresRule}`).toBeDefined();
      expect(finding!.acknowledged, `${plan.requiresRule} finding should be acknowledged`).toBe(true);
    }
  });

  it('builds one acknowledgement event per target', () => {
    const events = buildAcknowledgements([
      { findingId: 'f-aaa', ts: '2026-10-14T09:10:00.000Z' },
      { findingId: 'f-bbb', ts: '2026-10-16T13:00:00.000Z' },
    ]);
    expect(events.map((e) => (e.payload as { findingId: string }).findingId)).toEqual(['f-aaa', 'f-bbb']);
    expect(events.every((e) => e.type === 'problem.acknowledged')).toBe(true);
  });
});

describe('D3 · a finding id survives new evidence', () => {
  it('is stable when unrelated events are appended', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sl-seed-d3-'));
    const file = path.join(dir, 'events.jsonl');
    seedDemoLog(file);

    const before = fold(EventLog.open(file, 'persist').all());
    const refusal = [...before.refusals.values()][0]!;
    const id = findingIdFor('med-acetaminophen', ['R5'], refusal.eventId);

    const log = EventLog.open(file, 'persist');
    log.append([
      {
        type: 'dose.recorded',
        payload: { personId: 'person-robert', medicationId: 'med-acetaminophen', amountMg: 500 },
        actorId: 'caregiver-tom',
        actorRole: 'record',
        source: 'caregiver',
        ts: '2026-10-17T09:00:00.000Z',
      },
    ]);

    expect(findingIdFor('med-acetaminophen', ['R5'], refusal.eventId)).toBe(id);
  });

  it('does not depend on the order rules were evaluated in', () => {
    expect(findingIdFor('m', ['R5', 'R3'], 'e1')).toBe(findingIdFor('m', ['R3', 'R5'], 'e1'));
  });

  it('changes when the anchor event, the rule set or the medication changes', () => {
    const base = findingIdFor('m', ['R5'], 'e1');
    expect(findingIdFor('m', ['R3', 'R5'], 'e1')).not.toBe(base);
    expect(findingIdFor('m', ['R5'], 'other-event')).not.toBe(base);
    expect(findingIdFor('m2', ['R5'], 'e1')).not.toBe(base);
  });

  it('is exactly what the engine emits for a grouped finding', () => {
    const state = fold(seeded().log.all());
    const findings = findProblems(state, AS_OF);
    const ibu = findings.find((f) => f.medicationId === 'med-ibuprofen')!;

    // The anchor is the EARLIEST triggering event across the whole group, not
    // necessarily the most obvious one. For ibuprofen that is the plan
    // constraint (Day 1 08:10), which precedes both the discontinue (Day 3)
    // and the doses (Day 5) — R4's administered mode traces back to the bar.
    const anchor = state.planConstraints.provenance;
    expect(ibu.findingId).toBe(
      findingIdFor('med-ibuprofen', ['R3', 'R4', 'R6'], anchor.eventId),
    );
    // Guard the assumption itself, so this test cannot pass for the wrong reason.
    expect(Date.parse(anchor.ts)).toBeLessThan(
      Date.parse(state.medications.get('med-ibuprofen')!.status.provenance.ts),
    );
  });
});

describe('P2-9 · the scenario builds without the engine', () => {
  it('exposes the raw scenario without acknowledgements', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sl-seed-raw-'));
    const log = EventLog.open(path.join(dir, 'events.jsonl'), 'demo');
    const events = log.append(buildScenario());
    expect(events).toHaveLength(17);
    expect(events.some((e) => e.type === 'problem.acknowledged')).toBe(false);
  });
});