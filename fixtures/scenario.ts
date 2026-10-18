/**
 * The seeded §7 scenario (Phase 1, task P1-9).
 *
 * Synthetic person "Robert Alvarez", 74, hip replacement 2026-09-28,
 * hypertension + CKD stage 3. 100% synthetic, generated in code (PRD §10.1).
 *
 * DETERMINISM (plan D4): no `Date.now()`, no randomness. Every timestamp is a
 * literal. Running `npm run seed` twice produces a byte-identical JSONL file.
 *
 * The demo clock is FROZEN at Day 8 18:00. Rules receive this as an injected
 * `asOf`; they never read the wall clock.
 */
import type { NewEventInput } from '../server/log.js';

export const PERSON_ID = 'person-robert';
export const AS_OF = '2026-10-18T18:00:00.000Z'; // Day 8, 18:00

const DAY = (day: number, time: string): string =>
  new Date(Date.UTC(2026, 9, 10 + day, ...(time.split(':').map(Number) as [number, number, number])))
    .toISOString();

const PRIYA = 'caregiver-priya';
const TOM = 'caregiver-tom';
const ELENA = 'caregiver-elena';

export const ACETAMINOPHEN_ID = 'med-acetaminophen';
export const IBUPROFEN_ID = 'med-ibuprofen';

export const REQUEST_ID_ELENA = 'req-elena-acetaminophen-q4h';

/**
 * Every event before the acknowledgements.
 *
 * Acknowledgements are appended in a SECOND pass by `scripts/seed.ts`, because a
 * `problem.acknowledged` event must name the finding it acknowledges, and the
 * finding id depends on real anchor event ids that only exist once the earlier
 * events are in the chain (D3).
 */
export function buildScenario(): NewEventInput[] {
  return [
    // ── Day 1: registration, personas, plan constraint, discharge summary ──
    {
      type: 'person.registered',
      payload: {
        personId: PERSON_ID,
        name: 'Robert Alvarez',
        ageYears: 74,
        condition: 'Hip replacement 2026-09-28; hypertension; CKD stage 3',
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:00'),
    },
    {
      type: 'caregiver.joined',
      payload: { caregiverId: PRIYA, name: 'Priya', role: 'full' },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:01'),
    },
    {
      type: 'caregiver.joined',
      payload: { caregiverId: TOM, name: 'Tom', role: 'record' },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:02'),
    },
    {
      type: 'caregiver.joined',
      payload: { caregiverId: ELENA, name: 'Elena', role: 'none' },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:03'),
    },
    {
      type: 'plan.constraint_set',
      payload: {
        personId: PERSON_ID,
        barredClasses: ['NSAID'],
        reason: 'CKD stage 3',
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:10'),
    },
    {
      type: 'document.attached',
      payload: {
        personId: PERSON_ID,
        title: 'Nephrology note',
        kind: 'clinical note',
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'clinician',
      ts: DAY(1, '08:11'),
    },
    {
      type: 'document.attached',
      payload: {
        personId: PERSON_ID,
        title: 'Discharge summary',
        kind: 'discharge paperwork',
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'document',
      ts: DAY(1, '08:12'),
    },
    // Ibuprofen is prescribed while NSAIDs are barred -> R4 latent (high).
    {
      type: 'med.prescribed',
      payload: {
        personId: PERSON_ID,
        medicationId: ACETAMINOPHEN_ID,
        name: 'acetaminophen',
        doseMg: 500,
        form: 'IR',
        frequencyHours: 6,
        maxDailyMg: 3000,
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'document',
      ts: DAY(1, '08:20'),
    },
    {
      type: 'med.prescribed',
      payload: {
        personId: PERSON_ID,
        medicationId: IBUPROFEN_ID,
        name: 'ibuprofen',
        doseMg: 800,
        form: 'IR',
        frequencyHours: 6,
      },
      actorId: 'system:seed',
      actorRole: 'full',
      source: 'document',
      ts: DAY(1, '08:21'),
    },

    // ── Day 3: Priya stops ibuprofen on a pharmacist's call, NOT prescriber-confirmed.
    {
      type: 'med.discontinued',
      payload: {
        personId: PERSON_ID,
        medicationId: IBUPROFEN_ID,
        basis: 'pharmacist call',
        prescriberConfirmed: false,
      },
      actorId: PRIYA,
      actorRole: 'full',
      source: 'pharmacy',
      ts: DAY(3, '11:00'),
    },

    // ── Day 4: Elena (role none) asks for acetaminophen every 4h -> refused (R5).
    {
      type: 'authority.change_requested',
      payload: {
        personId: PERSON_ID,
        medicationId: ACETAMINOPHEN_ID,
        requestId: REQUEST_ID_ELENA,
        requesterId: ELENA,
        newFrequency: 4,
        reason: 'He seems in more pain than before',
      },
      actorId: ELENA,
      actorRole: 'none',
      source: 'caregiver',
      ts: DAY(4, '09:00'),
    },
    {
      type: 'authority.change_refused',
      payload: {
        personId: PERSON_ID,
        medicationId: ACETAMINOPHEN_ID,
        requestId: REQUEST_ID_ELENA,
        requesterId: ELENA,
        requesterRole: 'none',
        whoCan: 'full-authority caregiver',
      },
      actorId: PRIYA,
      actorRole: 'full',
      source: 'caregiver',
      ts: DAY(4, '09:05'),
    },

    // ── Day 5: ibuprofen given AFTER it was stopped (R3 + R4 critical; R6 for Elena).
    {
      type: 'dose.recorded',
      payload: { personId: PERSON_ID, medicationId: IBUPROFEN_ID, amountMg: 800 },
      actorId: TOM,
      actorRole: 'record',
      source: 'caregiver',
      ts: DAY(5, '14:00'),
    },
    {
      type: 'dose.recorded',
      payload: { personId: PERSON_ID, medicationId: IBUPROFEN_ID, amountMg: 800 },
      actorId: ELENA,
      actorRole: 'none',
      source: 'caregiver',
      ts: DAY(5, '20:00'),
    },

    // ── Day 6: acetaminophen at 08:00 then 12:00 — only 4h apart (R1).
    {
      type: 'dose.recorded',
      payload: { personId: PERSON_ID, medicationId: ACETAMINOPHEN_ID, amountMg: 500 },
      actorId: PRIYA,
      actorRole: 'full',
      source: 'caregiver',
      ts: DAY(6, '08:00'),
    },
    {
      type: 'dose.recorded',
      payload: { personId: PERSON_ID, medicationId: ACETAMINOPHEN_ID, amountMg: 500 },
      actorId: TOM,
      actorRole: 'record',
      source: 'caregiver',
      ts: DAY(6, '12:00'),
    },

    // ── Day 7: pharmacy delivers acetaminophen 650mg ER vs prescribed 500mg IR (R2).
    {
      type: 'med.dispensed',
      payload: {
        personId: PERSON_ID,
        medicationId: ACETAMINOPHEN_ID,
        doseMg: 650,
        form: 'ER',
        quantity: 60,
      },
      actorId: 'system:pharmacy',
      actorRole: 'full',
      source: 'pharmacy',
      ts: DAY(7, '10:00'),
    },
  ];
}

/**
 * What Priya acknowledges, and when.
 *
 * The finding ids are NOT hard-coded here. Grouping merges R1 and R2 into a
 * single finding per medication (PRD §6.5), so a hard-coded `['R1']` id would
 * never match what the engine actually produces. `seedDemoLog` resolves each
 * plan to the real finding that contains the named rule.
 */
export interface AcknowledgementPlan {
  /** The rule that must be present in the finding being acknowledged. */
  requiresRule: string;
  ts: string;
}

export const ACKNOWLEDGEMENTS: readonly AcknowledgementPlan[] = Object.freeze([
  // Day 4: Elena's refused regimen change.
  { requiresRule: 'R5', ts: DAY(4, '09:10') },
  // Day 6: the acetaminophen doses four hours apart.
  { requiresRule: 'R1', ts: DAY(6, '13:00') },
]);

export interface AcknowledgementTarget {
  findingId: string;
  ts: string;
}

/**
 * Second pass. `targets` carry the REAL finding ids read back from the engine,
 * so an acknowledgement can never dangle (D3).
 */
export function buildAcknowledgements(
  targets: readonly AcknowledgementTarget[],
): NewEventInput[] {
  return targets.map((target) => ({
    type: 'problem.acknowledged' as const,
    payload: {
      personId: PERSON_ID,
      findingId: target.findingId,
      acknowledgedById: PRIYA,
    },
    actorId: PRIYA,
    actorRole: 'full' as const,
    source: 'caregiver' as const,
    ts: target.ts,
  }));
}