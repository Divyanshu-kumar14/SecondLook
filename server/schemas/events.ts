/**
 * Shared event schemas — the single source of truth for the domain model.
 * Consumed by the server, the client and the tests (Phase 0, task P0-5).
 * Shapes follow PRD §6.1 / §6.2 exactly; nothing here is invented.
 */
import { z } from 'zod';

/** Roles are resolved SERVER-SIDE at write time, never client-supplied (PRD §5.4). */
export const RoleSchema = z.enum(['full', 'record', 'none']);
export type Role = z.infer<typeof RoleSchema>;

export const SourceSchema = z.enum(['clinician', 'pharmacy', 'caregiver', 'device', 'document']);
export type Source = z.infer<typeof SourceSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Machine-readable next action (PRD §6.4). */
export const NextActionSchema = z.enum([
  'STOP_GIVING',
  'CONTACT_PRESCRIBER',
  'ASK_AUTHORIZED_CAREGIVER',
  'CHECK_LABEL_WITH_PHARMACY',
  'RECORD_MISSING_DOSE',
  'ACKNOWLEDGE',
]);
export type NextAction = z.infer<typeof NextActionSchema>;

// ── Per-type payloads ──────────────────────────────────────────────────────────

export const PersonRegisteredPayload = z.object({
  personId: z.string().min(1),
  name: z.string().min(1),
  ageYears: z.number().int().nonnegative(),
  condition: z.string().min(1),
});
export type PersonRegistered = z.infer<typeof PersonRegisteredPayload>;

export const CaregiverJoinedPayload = z.object({
  caregiverId: z.string().min(1),
  name: z.string().min(1),
  role: RoleSchema,
});
export type CaregiverJoined = z.infer<typeof CaregiverJoinedPayload>;

export const CaregiverLeftPayload = z.object({
  caregiverId: z.string().min(1),
});
export type CaregiverLeft = z.infer<typeof CaregiverLeftPayload>;

export const CaregiverAuthorityChangedPayload = z.object({
  caregiverId: z.string().min(1),
  from: RoleSchema,
  to: RoleSchema,
});
export type CaregiverAuthorityChanged = z.infer<typeof CaregiverAuthorityChangedPayload>;

export const PlanConstraintSetPayload = z.object({
  personId: z.string().min(1),
  barredClasses: z.array(z.string().min(1)),
  reason: z.string().min(1),
});
export type PlanConstraintSet = z.infer<typeof PlanConstraintSetPayload>;

const MedicationCore = {
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  name: z.string().min(1),
  doseMg: z.number().positive(),
  form: z.string().min(1),
  frequencyHours: z.number().positive(),
};

export const MedPrescribedPayload = z
  .object({ ...MedicationCore, maxDailyMg: z.number().positive().optional() })
  .strict();
export type MedPrescribed = z.infer<typeof MedPrescribedPayload>;

export const MedChangedPayload = z.object({
  ...MedicationCore,
  maxDailyMg: z.number().positive().optional(),
  basis: z.string().min(1),
  prescriberConfirmed: z.boolean(),
});
export type MedChanged = z.infer<typeof MedChangedPayload>;

export const MedDiscontinuedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  basis: z.string().min(1),
  prescriberConfirmed: z.boolean(),
});
export type MedDiscontinued = z.infer<typeof MedDiscontinuedPayload>;

export const MedDispensedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  doseMg: z.number().positive(),
  form: z.string().min(1),
  quantity: z.number().int().positive().optional(),
});
export type MedDispensed = z.infer<typeof MedDispensedPayload>;

export const DoseRecordedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  amountMg: z.number().positive(),
});
export type DoseRecorded = z.infer<typeof DoseRecordedPayload>;

export const DoseMissedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  scheduledAt: z.string().min(1),
});
export type DoseMissed = z.infer<typeof DoseMissedPayload>;

export const ObservationRecordedPayload = z.object({
  personId: z.string().min(1),
  observation: z.string().min(1),
  trend: z.enum(['improving', 'stable', 'worsening']),
});
export type ObservationRecorded = z.infer<typeof ObservationRecordedPayload>;

export const AuthorityChangeRequestedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  requestId: z.string().min(1),
  requesterId: z.string().min(1),
  newDose: z.number().positive().optional(),
  newFrequency: z.number().positive().optional(),
  reason: z.string().min(1),
});
export type AuthorityChangeRequested = z.infer<typeof AuthorityChangeRequestedPayload>;

export const AuthorityChangeRefusedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  requestId: z.string().min(1),
  requesterId: z.string().min(1),
  requesterRole: RoleSchema,
  whoCan: z.string().min(1),
});
export type AuthorityChangeRefused = z.infer<typeof AuthorityChangeRefusedPayload>;

export const AuthorityChangeAppliedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  requestId: z.string().min(1),
  appliedById: z.string().min(1),
  newDose: z.number().positive().optional(),
  newFrequency: z.number().positive().optional(),
});
export type AuthorityChangeApplied = z.infer<typeof AuthorityChangeAppliedPayload>;

export const AuthorityChangeDeclinedPayload = z.object({
  personId: z.string().min(1),
  medicationId: z.string().min(1),
  requestId: z.string().min(1),
  declinedById: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type AuthorityChangeDeclined = z.infer<typeof AuthorityChangeDeclinedPayload>;

export const DocumentAttachedPayload = z.object({
  personId: z.string().min(1),
  title: z.string().min(1),
  kind: z.string().min(1),
});
export type DocumentAttached = z.infer<typeof DocumentAttachedPayload>;

export const ProblemAcknowledgedPayload = z.object({
  personId: z.string().min(1),
  findingId: z.string().min(1),
  acknowledgedById: z.string().min(1),
});
export type ProblemAcknowledged = z.infer<typeof ProblemAcknowledgedPayload>;

// ── Discriminated union of all 18 event types (PRD §6.2 + §8 addendum) ────────

export const EVENT_TYPES = [
  'person.registered',
  'caregiver.joined',
  'caregiver.left',
  'caregiver.authority_changed',
  'plan.constraint_set',
  'med.prescribed',
  'med.changed',
  'med.discontinued',
  'med.dispensed',
  'dose.recorded',
  'dose.missed',
  'observation.recorded',
  'authority.change_requested',
  'authority.change_refused',
  'authority.change_applied',
  'authority.change_declined',
  'document.attached',
  'problem.acknowledged',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Payload schema keyed by event type — the dispatch table. */
export const PAYLOAD_SCHEMAS = {
  'person.registered': PersonRegisteredPayload,
  'caregiver.joined': CaregiverJoinedPayload,
  'caregiver.left': CaregiverLeftPayload,
  'caregiver.authority_changed': CaregiverAuthorityChangedPayload,
  'plan.constraint_set': PlanConstraintSetPayload,
  'med.prescribed': MedPrescribedPayload,
  'med.changed': MedChangedPayload,
  'med.discontinued': MedDiscontinuedPayload,
  'med.dispensed': MedDispensedPayload,
  'dose.recorded': DoseRecordedPayload,
  'dose.missed': DoseMissedPayload,
  'observation.recorded': ObservationRecordedPayload,
  'authority.change_requested': AuthorityChangeRequestedPayload,
  'authority.change_refused': AuthorityChangeRefusedPayload,
  'authority.change_applied': AuthorityChangeAppliedPayload,
  'authority.change_declined': AuthorityChangeDeclinedPayload,
  'document.attached': DocumentAttachedPayload,
  'problem.acknowledged': ProblemAcknowledgedPayload,
} as const satisfies Record<EventType, z.ZodType>;

/** Validate a payload against its event type. Returns the parsed payload. */
export function parsePayload<T extends EventType>(
  type: T,
  payload: unknown,
): z.infer<(typeof PAYLOAD_SCHEMAS)[T]> {
  return PAYLOAD_SCHEMAS[type].parse(payload) as z.infer<(typeof PAYLOAD_SCHEMAS)[T]>;
}

/** Union of every legal `type` + payload pairing. Used to validate stored rows. */
export const EventBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('person.registered'), payload: PersonRegisteredPayload }),
  z.object({ type: z.literal('caregiver.joined'), payload: CaregiverJoinedPayload }),
  z.object({ type: z.literal('caregiver.left'), payload: CaregiverLeftPayload }),
  z.object({ type: z.literal('caregiver.authority_changed'), payload: CaregiverAuthorityChangedPayload }),
  z.object({ type: z.literal('plan.constraint_set'), payload: PlanConstraintSetPayload }),
  z.object({ type: z.literal('med.prescribed'), payload: MedPrescribedPayload }),
  z.object({ type: z.literal('med.changed'), payload: MedChangedPayload }),
  z.object({ type: z.literal('med.discontinued'), payload: MedDiscontinuedPayload }),
  z.object({ type: z.literal('med.dispensed'), payload: MedDispensedPayload }),
  z.object({ type: z.literal('dose.recorded'), payload: DoseRecordedPayload }),
  z.object({ type: z.literal('dose.missed'), payload: DoseMissedPayload }),
  z.object({ type: z.literal('observation.recorded'), payload: ObservationRecordedPayload }),
  z.object({ type: z.literal('authority.change_requested'), payload: AuthorityChangeRequestedPayload }),
  z.object({ type: z.literal('authority.change_refused'), payload: AuthorityChangeRefusedPayload }),
  z.object({ type: z.literal('authority.change_applied'), payload: AuthorityChangeAppliedPayload }),
  z.object({ type: z.literal('authority.change_declined'), payload: AuthorityChangeDeclinedPayload }),
  z.object({ type: z.literal('document.attached'), payload: DocumentAttachedPayload }),
  z.object({ type: z.literal('problem.acknowledged'), payload: ProblemAcknowledgedPayload }),
]);

/**
 * Event envelope (PRD §6.1). `prevHash`/`hash` are the tamper-evident chain;
 * the hashing itself lands in Phase 1 (P1-1).
 */
export const EventSchema = EventBodySchema.and(
  z.object({
    eventId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    ts: z.string().min(1),
    actorId: z.string().min(1),
    actorRole: RoleSchema,
    source: SourceSchema,
    supersedes: z.string().min(1).optional(),
    prevHash: z.string(),
    hash: z.string(),
  }),
);

export type CareEvent = z.infer<typeof EventSchema>;