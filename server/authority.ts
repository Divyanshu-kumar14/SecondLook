/**
 * Authority model and refusal logic (Phase 1, task P1-7).
 *
 * PRD §6.4: "Recording is never blocked. A real dose that happened must be
 * loggable by anyone; `record_dose` accepts and flags (R6) rather than
 * refusing. Only plan changes are refused."
 *
 * A REFUSAL IS A SUCCESSFUL RESULT, never an error (PRD §8). That is why this
 * module returns a decision object rather than throwing.
 *
 * DoD §1.5 requires 100% line coverage here — this is the security-critical
 * path, so it is kept deliberately small, total and branch-complete.
 */
import type { Role } from './schemas/events.js';

export const PERMISSIONS = ['read_record', 'record_dose', 'request_plan_change'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role -> permission matrix.
 *
 * `read_record` and `record_dose` are granted to EVERY role, including `none`:
 * a guest may read the record, and a real dose must always be recordable. The
 * matrix therefore differs on exactly one axis — who may change a regimen.
 */
const MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze({
  full: new Set<Permission>(['read_record', 'record_dose', 'request_plan_change']),
  record: new Set<Permission>(['read_record', 'record_dose']),
  none: new Set<Permission>(['read_record', 'record_dose']),
});

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Roles allowed to change a regimen, strongest first. */
export const ROLES_THAT_MAY_CHANGE: readonly Role[] = ['full'];

export interface Refusal {
  code: 'UNAUTHORIZED_PLAN_CHANGE';
  whoCan: string;
  sinceWhen: string;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; refusal: Refusal };

const ROLE_LABEL: Readonly<Record<Role, string>> = Object.freeze({
  full: 'full-authority caregiver',
  record: 'record-only caregiver',
  none: 'unauthorised caregiver (role none)',
});

/**
 * Decide whether `role` may perform `permission`.
 *
 * `sinceWhen` is supplied by the caller because the answer depends on the
 * event log (PRD §7: the refusal records when the requester's role fell below
 * `full`), never on the current clock.
 */
export function decide(
  role: Role,
  permission: Permission,
  sinceWhen: string,
): Decision {
  if (hasPermission(role, permission)) return { allowed: true };
  return {
    allowed: false,
    refusal: {
      code: 'UNAUTHORIZED_PLAN_CHANGE',
      whoCan: ROLES_THAT_MAY_CHANGE.map((r) => ROLE_LABEL[r]).join(' or '),
      sinceWhen,
    },
  };
}

/**
 * Convenience for the one refusing tool. A refusal here is a SUCCESSFUL
 * outcome the caller renders — never an exception.
 */
export function decidePlanChange(
  role: Role,
  sinceWhen: string,
): { status: 'applied' } | { status: 'refused'; refusal: Refusal } {
  const decision = decide(role, 'request_plan_change', sinceWhen);
  return decision.allowed
    ? { status: 'applied' }
    : { status: 'refused', refusal: decision.refusal };
}