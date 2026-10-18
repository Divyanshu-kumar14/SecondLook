import { describe, expect, it } from 'vitest';
import { r1DoseInterval } from '../server/rules/r1.js';
import { r2DispenseMismatch } from '../server/rules/r2.js';
import { r3SupersededInUse } from '../server/rules/r3.js';
import { r4ClassBarredByPlan } from '../server/rules/r4.js';
import { r5UnauthorizedPlanChange } from '../server/rules/r5.js';
import { r6UnauthorizedAdministration } from '../server/rules/r6.js';
import {
  AS_OF,
  MED_A,
  PERSON,
  barClasses,
  at,
  dose,
  join,
  personEvent,
  prescribe,
  stateOf,
} from './helpers/rules-harness.js';

describe('P2-2 · R1 DOSE_INTERVAL', () => {
  const base = [personEvent, prescribe(MED_A, 'acetaminophen', { frequencyHours: 6, maxDailyMg: 3000 })];

  it('fires when two doses are closer than interval minus tolerance', () => {
    const hits = r1DoseInterval(stateOf([...base, dose(MED_A, 500, 1, '08:00'), dose(MED_A, 500, 1, '12:00')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      ruleId: 'R1',
      severity: 'medium',
      groupKey: MED_A,
      medicationId: MED_A,
      nextAction: 'CONTACT_PRESCRIBER',
    });
    expect(hits[0]!.evidence).toHaveLength(2);
  });

  it('respects the 30 minute tolerance — a 5h35m gap does not fire', () => {
    // 6h interval, 30 min tolerance => fires only below 5h30m.
    const hits = r1DoseInterval(stateOf([...base, dose(MED_A, 500, 1, '08:00'), dose(MED_A, 500, 1, '13:35')]), AS_OF);
    expect(hits).toHaveLength(0);
  });

  it('fires just inside the tolerance boundary', () => {
    const hits = r1DoseInterval(stateOf([...base, dose(MED_A, 500, 1, '08:00'), dose(MED_A, 500, 1, '13:29')]), AS_OF);
    expect(hits).toHaveLength(1);
  });

  it('honours a custom tolerance', () => {
    // A 4 h gap violates a 6 h interval minus 30 min, but is inside 6 h minus 180 min.
    const events = [...base, dose(MED_A, 500, 1, '08:00'), dose(MED_A, 500, 1, '12:00')];
    expect(r1DoseInterval(stateOf(events), AS_OF)).toHaveLength(1);
    expect(r1DoseInterval(stateOf(events), AS_OF, 180)).toHaveLength(0);
  });

  it('escalates to HIGH when the rolling 24h total exceeds maxDailyMg', () => {
    // asOf is Day 7 18:00, so the rolling window opens at Day 6 18:00.
    const doses = [
      dose(MED_A, 1200, 6, '20:00'),
      dose(MED_A, 1200, 7, '00:00'),
      dose(MED_A, 1200, 7, '04:00'),
    ];
    const hits = r1DoseInterval(stateOf([...base, ...doses]), AS_OF);
    const overCap = hits.find((h) => h.severity === 'high');
    expect(overCap).toBeDefined();
    expect(overCap!.what).toMatch(/exceeds the prescribed maximum of 3000 mg/);
  });

  it('does not fire for doses after the injected asOf', () => {
    const hits = r1DoseInterval(stateOf([...base, dose(MED_A, 500, 1, '08:00'), dose(MED_A, 500, 7, '20:00')]), AS_OF);
    expect(hits).toHaveLength(0);
  });

  it('returns nothing when a medication has fewer than two doses', () => {
    expect(r1DoseInterval(stateOf([...base, dose(MED_A, 500, 1, '08:00')]), AS_OF)).toHaveLength(0);
    expect(r1DoseInterval(stateOf(base), AS_OF)).toHaveLength(0);
  });

  it('anchors on the EARLIER dose so the id survives later evidence', () => {
    const first = dose(MED_A, 500, 1, '08:00');
    const hits = r1DoseInterval(stateOf([...base, first, dose(MED_A, 500, 1, '12:00')]), AS_OF);
    expect(hits[0]!.anchorTs).toBe(first.ts);
  });
});

describe('P2-3 · R2 DISPENSE_MISMATCH', () => {
  const base = [personEvent, prescribe(MED_A, 'acetaminophen', { doseMg: 500, form: 'IR' })];

  const dispense = (doseMg: number, form: string, day = 5, time = '10:00'): NewEventInputShape => ({
    type: 'med.dispensed',
    payload: { personId: PERSON, medicationId: MED_A, doseMg, form, quantity: 60 },
    actorId: 'system:pharmacy',
    actorRole: 'full',
    source: 'pharmacy',
    ts: at(day, time),
  });
  type NewEventInputShape = Parameters<typeof stateOf>[0][number];

  it('fires on a dose mismatch and names both numbers', () => {
    const hits = r2DispenseMismatch(stateOf([...base, dispense(650, 'ER')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'R2', severity: 'high', nextAction: 'CHECK_LABEL_WITH_PHARMACY' });
    expect(hits[0]!.what).toMatch(/500 mg prescribed but 650 mg dispensed/);
    expect(hits[0]!.what).toMatch(/IR prescribed but ER dispensed/);
  });

  it('fires on a form-only mismatch', () => {
    const hits = r2DispenseMismatch(stateOf([...base, dispense(500, 'ER')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.what).toMatch(/IR prescribed but ER dispensed/);
    expect(hits[0]!.what).not.toMatch(/mg dispensed/);
  });

  it('does not fire when the dispense matches the prescription', () => {
    expect(r2DispenseMismatch(stateOf([...base, dispense(500, 'IR')]), AS_OF)).toHaveLength(0);
  });

  it('ignores a dispense for an unknown medication', () => {
    const orphan = { ...dispense(650, 'ER'), payload: { personId: PERSON, medicationId: 'med-ghost', doseMg: 650, form: 'ER' } } as NewEventInputShape;
    expect(r2DispenseMismatch(stateOf([...base, orphan]), AS_OF)).toHaveLength(0);
  });

  it('ignores a dispense after asOf', () => {
    expect(r2DispenseMismatch(stateOf([...base, dispense(650, 'ER', 7, '20:00')]), AS_OF)).toHaveLength(0);
  });

  it('cites the prescription and the dispense as evidence', () => {
    const hits = r2DispenseMismatch(stateOf([...base, dispense(650, 'ER')]), AS_OF);
    expect(hits[0]!.evidence).toHaveLength(2);
  });
});

describe('P2-4 · R3 SUPERSEDED_IN_USE', () => {
  const stop = (confirmed = false): NewEventInputShape => ({
    type: 'med.discontinued',
    payload: { personId: PERSON, medicationId: MED_A, basis: 'pharmacist call', prescriberConfirmed: confirmed },
    actorId: 'caregiver-priya',
    actorRole: 'full',
    source: 'pharmacy',
    ts: at(3, '11:00'),
  });
  type NewEventInputShape = Parameters<typeof stateOf>[0][number];

  const base = [personEvent, prescribe(MED_A, 'ibuprofen'), stop()];

  it('is CRITICAL when a dose follows a discontinue', () => {
    const hits = r3SupersededInUse(stateOf([...base, dose(MED_A, 800, 5, '14:00')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'R3', severity: 'critical', nextAction: 'STOP_GIVING' });
  });

  it('says the stop was never prescriber-confirmed when it was not', () => {
    const hits = r3SupersededInUse(stateOf([...base, dose(MED_A, 800, 5, '14:00')]), AS_OF);
    expect(hits[0]!.what).toMatch(/never confirmed by the prescriber/);
  });

  it('omits that clause when the prescriber did confirm', () => {
    const hits = r3SupersededInUse(stateOf([personEvent, prescribe(MED_A, 'ibuprofen'), stop(true), dose(MED_A, 800, 5, '14:00')]), AS_OF);
    expect(hits[0]!.what).not.toMatch(/never confirmed/);
  });

  it('fires once per offending dose', () => {
    const hits = r3SupersededInUse(stateOf([...base, dose(MED_A, 800, 5, '14:00'), dose(MED_A, 800, 5, '20:00')]), AS_OF);
    expect(hits).toHaveLength(2);
  });

  it('does not fire for a dose before the discontinue', () => {
    expect(r3SupersededInUse(stateOf([personEvent, prescribe(MED_A, 'ibuprofen'), dose(MED_A, 800, 1, '08:00'), stop()]), AS_OF)).toHaveLength(0);
  });

  it('does not fire when the medication is still active', () => {
    expect(r3SupersededInUse(stateOf([personEvent, prescribe(MED_A, 'ibuprofen'), dose(MED_A, 800, 5, '14:00')]), AS_OF)).toHaveLength(0);
  });

  it('ignores a dose recorded after asOf', () => {
    expect(r3SupersededInUse(stateOf([...base, dose(MED_A, 800, 7, '20:00')]), AS_OF)).toHaveLength(0);
  });
});

describe('P2-5 · R4 CLASS_BARRED_BY_PLAN (both modes)', () => {
  it('LATENT mode: prescribed in a barred class is HIGH', () => {
    const hits = r4ClassBarredByPlan(stateOf([personEvent, barClasses(['NSAID']), prescribe(MED_A, 'ibuprofen')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'R4', severity: 'high', nextAction: 'CONTACT_PRESCRIBER' });
    expect(hits[0]!.what).toMatch(/still on the list/);
  });

  it('ADMINISTERED mode: given in a barred class is CRITICAL', () => {
    const hits = r4ClassBarredByPlan(
      stateOf([personEvent, barClasses(['NSAID']), prescribe(MED_A, 'ibuprofen'), dose(MED_A, 800, 5, '14:00')]),
      AS_OF,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'R4', severity: 'critical', nextAction: 'STOP_GIVING' });
    expect(hits[0]!.what).toMatch(/it was given on/);
  });

  it('ADMINISTERED mode supersedes LATENT rather than doubling the finding', () => {
    const hits = r4ClassBarredByPlan(
      stateOf([personEvent, barClasses(['NSAID']), prescribe(MED_A, 'ibuprofen'), dose(MED_A, 800, 5, '14:00'), dose(MED_A, 800, 5, '20:00')]),
      AS_OF,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.evidence.length).toBeGreaterThan(2);
  });

  it('does not fire for a class the plan does not bar', () => {
    expect(r4ClassBarredByPlan(stateOf([personEvent, barClasses(['OPIOID']), prescribe(MED_A, 'ibuprofen')]), AS_OF)).toHaveLength(0);
  });

  it('does not fire for a drug that is not in the formulary', () => {
    expect(r4ClassBarredByPlan(stateOf([personEvent, barClasses(['NSAID']), prescribe(MED_A, 'synthetic-unknown')]), AS_OF)).toHaveLength(0);
  });

  it('does not fire when the plan bars nothing', () => {
    expect(r4ClassBarredByPlan(stateOf([personEvent, prescribe(MED_A, 'ibuprofen')]), AS_OF)).toHaveLength(0);
  });

  it('anchors on whichever came first: the bar or the prescription', () => {
    const hits = r4ClassBarredByPlan(stateOf([personEvent, barClasses(['NSAID']), prescribe(MED_A, 'ibuprofen')]), AS_OF);
    expect(hits[0]!.anchorTs).toBe(at(0, '07:05'));
  });

  it('includes the plan reason so the claim is sourced', () => {
    const hits = r4ClassBarredByPlan(stateOf([personEvent, barClasses(['NSAID'], 'CKD stage 3'), prescribe(MED_A, 'ibuprofen')]), AS_OF);
    expect(hits[0]!.what).toMatch(/\(CKD stage 3\)/);
  });
});

describe('P2-6 · R5 UNAUTHORIZED_PLAN_CHANGE', () => {
  const request = (requesterId: string, role: 'full' | 'record' | 'none') => ({
    type: 'authority.change_requested' as const,
    payload: { personId: PERSON, medicationId: MED_A, requestId: 'req-1', requesterId, newFrequency: 4, reason: 'pain' },
    actorId: requesterId,
    actorRole: role,
    source: 'caregiver' as const,
    ts: at(4, '09:00'),
  });
  const refusal = (requesterId: string, role: 'full' | 'record' | 'none') => ({
    type: 'authority.change_refused' as const,
    payload: { personId: PERSON, medicationId: MED_A, requestId: 'req-1', requesterId, requesterRole: role, whoCan: 'full-authority caregiver' },
    actorId: 'caregiver-priya',
    actorRole: 'full' as const,
    source: 'caregiver' as const,
    ts: at(4, '09:05'),
  });

  const base = [personEvent, prescribe(MED_A, 'acetaminophen')];

  it('fires HIGH for a requester below full authority', () => {
    for (const role of ['record', 'none'] as const) {
      const hits = r5UnauthorizedPlanChange(stateOf([...base, request('caregiver-elena', role), refusal('caregiver-elena', role)]), AS_OF);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ ruleId: 'R5', severity: 'high', nextAction: 'ASK_AUTHORIZED_CAREGIVER' });
    }
  });

  it('does not fire when the requester held full authority', () => {
    expect(r5UnauthorizedPlanChange(stateOf([...base, request('caregiver-priya', 'full'), refusal('caregiver-priya', 'full')]), AS_OF)).toHaveLength(0);
  });

  it('reports ONE finding per request, keyed by request id', () => {
    const hits = r5UnauthorizedPlanChange(stateOf([...base, request('caregiver-elena', 'none'), refusal('caregiver-elena', 'none')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.groupKey).toBe('request:req-1');
    // The findingId basis is the medication, not the request key.
    expect(hits[0]!.medicationId).toBe(MED_A);
  });

  it('ignores a refusal recorded after asOf', () => {
    const late = { ...refusal('caregiver-elena', 'none' as const), ts: at(7, '20:05') };
    expect(r5UnauthorizedPlanChange(stateOf([...base, request('caregiver-elena', 'none'), late]), AS_OF)).toHaveLength(0);
  });

  it('names the requester and their role', () => {
    const hits = r5UnauthorizedPlanChange(stateOf([...base, request('caregiver-elena', 'none'), refusal('caregiver-elena', 'none')]), AS_OF);
    expect(hits[0]!.what).toMatch(/role none/);
    expect(hits[0]!.evidence).toHaveLength(1);
  });
});

describe('P2-7 · R6 UNAUTHORIZED_ADMINISTRATION', () => {
  const base = [personEvent, prescribe(MED_A, 'ibuprofen'), join('caregiver-tom', 'record'), join('caregiver-elena', 'none')];

  it('fires MEDIUM for a dose recorded by role none', () => {
    const hits = r6UnauthorizedAdministration(stateOf([...base, dose(MED_A, 800, 5, '20:00', 'caregiver-elena', 'none')]), AS_OF);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'R6', severity: 'medium', nextAction: 'ASK_AUTHORIZED_CAREGIVER' });
    expect(hits[0]!.what).toMatch(/no authority to give medication/);
  });

  it('does not fire for record or full roles', () => {
    expect(r6UnauthorizedAdministration(stateOf([...base, dose(MED_A, 800, 5, '14:00', 'caregiver-tom', 'record')]), AS_OF)).toHaveLength(0);
    expect(r6UnauthorizedAdministration(stateOf([...base, dose(MED_A, 800, 5, '14:00', 'caregiver-priya', 'full')]), AS_OF)).toHaveLength(0);
  });

  it('reads the role from the EVENT, not from current caregiver state', () => {
    // Elena has since been given full authority, but the historical truth is
    // what the rule reports.
    const promoted = {
      type: 'caregiver.authority_changed' as const,
      payload: { caregiverId: 'caregiver-elena', from: 'none' as const, to: 'full' as const },
      actorId: 'caregiver-priya',
      actorRole: 'full' as const,
      source: 'clinician' as const,
      ts: at(6, '09:00'),
    };
    const hits = r6UnauthorizedAdministration(
      stateOf([...base, dose(MED_A, 800, 5, '20:00', 'caregiver-elena', 'none'), promoted]),
      AS_OF,
    );
    expect(hits).toHaveLength(1);
  });

  it('never refuses — it flags, because a real dose must stay loggable', () => {
    const hits = r6UnauthorizedAdministration(stateOf([...base, dose(MED_A, 800, 5, '20:00', 'caregiver-elena', 'none')]), AS_OF);
    expect(hits[0]!.severity).toBe('medium');
    expect(hits[0]!.nextAction).toBe('ASK_AUTHORIZED_CAREGIVER');
  });

  it('ignores a dose after asOf', () => {
    expect(r6UnauthorizedAdministration(stateOf([...base, dose(MED_A, 800, 7, '20:00', 'caregiver-elena', 'none')]), AS_OF)).toHaveLength(0);
  });
});