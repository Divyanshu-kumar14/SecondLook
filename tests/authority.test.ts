import { describe, expect, it } from 'vitest';
import {
  decide,
  decidePlanChange,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
  ROLES_THAT_MAY_CHANGE,
} from '../server/authority.js';
import type { Role } from '../server/schemas/events.js';

const ROLES: Role[] = ['full', 'record', 'none'];

describe('P1-7 · authority matrix', () => {
  it('grants read_record to every role, including none, so guests can read', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'read_record'), `role ${role}`).toBe(true);
    }
  });

  it('grants record_dose to every role — recording is NEVER blocked (PRD §6.4)', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'record_dose'), `role ${role}`).toBe(true);
    }
  });

  it('grants request_plan_change to full only', () => {
    expect(hasPermission('full', 'request_plan_change')).toBe(true);
    expect(hasPermission('record', 'request_plan_change')).toBe(false);
    expect(hasPermission('none', 'request_plan_change')).toBe(false);
    expect(ROLES_THAT_MAY_CHANGE).toEqual(['full']);
  });

  it('grants resolve_plan_change to full only — settling is a plan change too', () => {
    expect(hasPermission('full', 'resolve_plan_change')).toBe(true);
    expect(hasPermission('record', 'resolve_plan_change')).toBe(false);
    expect(hasPermission('none', 'resolve_plan_change')).toBe(false);
  });

  it('covers every permission for every role, with no branch left untested', () => {
    for (const role of ROLES) {
      const granted = permissionsFor(role);
      expect(new Set(granted).size, `role ${role} must not list a permission twice`).toBe(granted.length);
      for (const permission of PERMISSIONS) {
        expect(granted.includes(permission)).toBe(hasPermission(role, permission));
      }
    }
  });
});

describe('P1-7 · refusal is a result, never an error', () => {
  it('allows a full-authority caregiver to change a regimen', () => {
    expect(decide('full', 'request_plan_change', '2026-10-14T09:05:00.000Z')).toEqual({ allowed: true });
  });

  it('refuses below-full roles with a structured, non-throwing refusal', () => {
    for (const role of ['record', 'none'] as const) {
      const decision = decide(role, 'request_plan_change', '2026-10-14T09:05:00.000Z');
      expect(decision.allowed).toBe(false);
      if (decision.allowed) throw new Error('unreachable');
      expect(decision.refusal.code).toBe('UNAUTHORIZED_PLAN_CHANGE');
      expect(decision.refusal.whoCan).toBe('full-authority caregiver');
      expect(decision.refusal.sinceWhen).toBe('2026-10-14T09:05:00.000Z');
    }
  });

  it('passes sinceWhen through verbatim — it comes from the log, never the clock', () => {
    const stamp = '1999-12-31T23:59:59.000Z';
    const decision = decide('none', 'request_plan_change', stamp);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(decision.refusal.sinceWhen).toBe(stamp);
  });

  it('decidePlanChange returns applied or refused, and never throws', () => {
    expect(decidePlanChange('full', 'x')).toEqual({ status: 'applied' });
    expect(decidePlanChange('record', 'x')).toMatchObject({
      status: 'refused',
      refusal: { code: 'UNAUTHORIZED_PLAN_CHANGE' },
    });
    expect(decidePlanChange('none', 'x')).toMatchObject({ status: 'refused' });
  });
});