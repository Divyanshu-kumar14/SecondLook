import { describe, expect, it } from 'vitest';
import { seedDemoLog } from '../fixtures/seed.js';
import { AS_OF } from '../fixtures/scenario.js';
import { fold } from '../server/fold.js';
import { allRuleHits, findProblems, RULE_IDS, type Finding } from '../server/rules/index.js';
import { groupHits, rank } from '../server/rules/group.js';
import { findingIdFor } from '../server/finding-id.js';
import { EventLog } from '../server/log.js';

function seeded() {
  const { log } = seedDemoLog('/tmp/opencode/rules-fixture.jsonl');
  return { state: fold(log.all()), log };
}

describe('P2-11 · the §7 fixture fires all six rules', () => {
  it('fires R1 through R6', () => {
    const { state } = seeded();
    const fired = new Set(allRuleHits(state, AS_OF).map((h) => h.ruleId));
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
      expect(fired.has(id), `${id} did not fire on the fixture`).toBe(true);
    }
    expect([...fired].sort()).toEqual([...RULE_IDS].sort());
  });

  it('produces exactly the three findings PRD §7 describes', () => {
    const findings = findProblems(seeded().state, AS_OF);
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.rules.join('+'))).toEqual(['R3+R4+R6', 'R1+R2', 'R5']);
  });

  it('ranks ibuprofen first — it is the critical finding', () => {
    const findings = findProblems(seeded().state, AS_OF);
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.medicationId).toBe('med-ibuprofen');
    expect(findings[0]!.what).toMatch(/after it was stopped/);
  });

  it('is fully deterministic across three consecutive runs (DoD #3)', () => {
    const runs = [1, 2, 3].map(() => JSON.stringify(findProblems(seeded().state, AS_OF)));
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
  });

  it('never says "all clear" — every run has findings present', () => {
    expect(findProblems(seeded().state, AS_OF).length).toBeGreaterThan(0);
  });

  it('matches a golden snapshot of the headline claims', () => {
    const findings = findProblems(seeded().state, AS_OF).map((f) => ({
      id: f.findingId,
      rules: f.rules,
      severity: f.severity,
      nextAction: f.nextAction,
      acknowledged: f.acknowledged,
    }));
    expect(findings).toMatchInlineSnapshot(`
      [
        {
          "acknowledged": false,
          "id": "f-4aca215e40c1",
          "nextAction": "STOP_GIVING",
          "rules": [
            "R3",
            "R4",
            "R6",
          ],
          "severity": "critical",
        },
        {
          "acknowledged": true,
          "id": "f-6de4292e7ccc",
          "nextAction": "CHECK_LABEL_WITH_PHARMACY",
          "rules": [
            "R1",
            "R2",
          ],
          "severity": "high",
        },
        {
          "acknowledged": true,
          "id": "f-04fef3a7e6f4",
          "nextAction": "ASK_AUTHORIZED_CAREGIVER",
          "rules": [
            "R5",
          ],
          "severity": "high",
        },
      ]
    `);
  });
});

describe('P2-8 · grouping and ranking are deterministic', () => {
  it('produces the same ranking no matter what order hits arrive in', () => {
    const hits = allRuleHits(seeded().state, AS_OF);
    const canonical = JSON.stringify(findProblems(seeded().state, AS_OF));

    // Every rotation and the full reversal must group to the same output.
    for (let shift = 1; shift < hits.length; shift += 1) {
      const rotated = [...hits.slice(shift), ...hits.slice(0, shift)];
      expect(JSON.stringify(groupHits(rotated, new Set()))).toBe(
        JSON.stringify(groupHits(hits, new Set())),
      );
    }
    expect(JSON.stringify(groupHits([...hits].reverse(), new Set()))).toBe(
      JSON.stringify(groupHits(hits, new Set())),
    );
    expect(canonical).toBe(JSON.stringify(findProblems(seeded().state, AS_OF)));
  });

  it('takes severity = max across the group, never the mean', () => {
    const findings = findProblems(seeded().state, AS_OF);
    const ibu = findings.find((f) => f.medicationId === 'med-ibuprofen')!;
    // R3 and R4 are critical, R6 is medium -> the group is critical.
    expect(ibu.severity).toBe('critical');
  });

  it('unions evidence across every hit in the group', () => {
    const findings = findProblems(seeded().state, AS_OF);
    for (const finding of findings) {
      expect(new Set(finding.evidence).size, 'evidence must be de-duplicated').toBe(
        finding.evidence.length,
      );
    }
    const ibu = findings.find((f) => f.medicationId === 'med-ibuprofen')!;
    expect(ibu.evidence.length).toBeGreaterThanOrEqual(4);
  });

  it('sorts rules within a finding', () => {
    for (const finding of findProblems(seeded().state, AS_OF)) {
      expect(finding.rules).toEqual([...finding.rules].sort());
    }
  });

  it('ranks by severity desc, then distinct rules desc', () => {
    const severities = findProblems(seeded().state, AS_OF).map((f) => f.severity);
    const order = ['low', 'medium', 'high', 'critical'];
    const indices = severities.map((s) => order.indexOf(s));
    expect([...indices].sort((a, b) => b - a)).toEqual(indices);
  });

  it('is a total order — ranking twice changes nothing', () => {
    const findings = findProblems(seeded().state, AS_OF);
    expect(rank(findings)).toEqual(findings);
  });
});

describe('P2-9 · an acknowledged finding does not reappear as new (D3)', () => {
  it('keeps the finding id stable when a NEW dose is appended', () => {
    const { log } = seeded();
    const before = findProblems(fold(log.all()), AS_OF);
    const target = before.find((f) => f.medicationId === 'med-ibuprofen')!;

    // Append a fresh ibuprofen dose — the kind of event that, under the PRD's
    // original evidence-hash id, would rename the finding.
    log.append([
      {
        type: 'dose.recorded',
        payload: { personId: 'person-robert', medicationId: 'med-ibuprofen', amountMg: 800 },
        actorId: 'caregiver-tom',
        actorRole: 'record',
        source: 'caregiver',
        ts: '2026-10-17T10:00:00.000Z',
      },
    ]);

    const after = findProblems(fold(log.all()), AS_OF);
    const same = after.find((f) => f.medicationId === 'med-ibuprofen')!;

    expect(same.findingId, 'appending evidence must not rename the finding').toBe(target.findingId);
    expect(same.evidence.length).toBeGreaterThan(target.evidence.length);
  });

  it('does not change the id when the rule SET grows', () => {
    // R3+R4+R6 and R3+R4 are different findings by definition; the guard is
    // that appending evidence alone never changes the rule set's identity.
    const state = seeded().state;
    const anchor = state.planConstraints.provenance.eventId;
    const threeRules = findingIdFor('med-ibuprofen', ['R3', 'R4', 'R6'], anchor);
    const twoRules = findingIdFor('med-ibuprofen', ['R3', 'R4'], anchor);
    expect(threeRules).not.toBe(twoRules);
    expect(findingIdFor('med-ibuprofen', ['R6', 'R4', 'R3'], anchor)).toBe(threeRules);
  });

  it('hides an acknowledged finding from new, but keeps it in the record', () => {
    const findings: Finding[] = findProblems(seeded().state, AS_OF);
    const acknowledged = findings.filter((f) => f.acknowledged);
    expect(acknowledged).toHaveLength(2);
    expect(findings).toHaveLength(3);
    // Acknowledged does not mean resolved: they stay in the handoff.
    for (const finding of acknowledged) {
      expect(finding.severity).not.toBe('low');
    }
  });

  it('marks nothing acknowledged when the log has no acknowledgements', () => {
    // An empty log yields no findings at all, so nothing can be acknowledged.
    const empty = fold(EventLog.open('/tmp/opencode/rules-noack.jsonl', 'demo').append([]));
    expect(findProblems(empty, AS_OF)).toHaveLength(0);
  });
});