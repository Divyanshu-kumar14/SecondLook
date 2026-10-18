import { describe, expect, it } from 'vitest';
import {
  displayNameFor,
  GUEST,
  personaTokenFor,
  resolveIdentity,
  roleForCaregiver,
} from '../server/identity.js';

describe('P1-5 · identity resolution', () => {
  it('maps each demo bearer token to its persona and role', () => {
    expect(resolveIdentity('Bearer demo-priya')).toMatchObject({
      caregiverId: 'caregiver-priya',
      displayName: 'Priya',
      role: 'full',
    });
    expect(resolveIdentity('Bearer demo-tom')).toMatchObject({ role: 'record' });
    expect(resolveIdentity('Bearer demo-elena')).toMatchObject({ role: 'none' });
  });

  it('is case-insensitive on the scheme and the token', () => {
    expect(resolveIdentity('bearer demo-priya').role).toBe('full');
    expect(resolveIdentity('BEARER DEMO-TOM').role).toBe('record');
  });

  it('falls back to guest with role none when no header is present', () => {
    expect(resolveIdentity(undefined)).toEqual(GUEST);
    expect(resolveIdentity('')).toEqual(GUEST);
    expect(GUEST.role).toBe('none');
    expect(GUEST.isGuest).toBe(true);
  });

  it('degrades to guest on garbage instead of throwing', () => {
    // A client must never be able to crash the server or forge a role.
    for (const header of ['Basic abc', 'Bearer', 'Bearer    ', 'demo-priya', 'Bearer unknown-token', 'Bearer <script>']) {
      expect(resolveIdentity(header), `header: ${header}`).toEqual(GUEST);
    }
  });

  it('does not match a token by substring', () => {
    expect(resolveIdentity('Bearer demo-priya-extra')).toEqual(GUEST);
    expect(resolveIdentity('Bearer xxdemo-priya')).toEqual(GUEST);
  });

  it('resolves helpers symmetrically for the fixture and handoff copy', () => {
    expect(roleForCaregiver('caregiver-priya')).toBe('full');
    expect(roleForCaregiver('caregiver-tom')).toBe('record');
    expect(roleForCaregiver('caregiver-elena')).toBe('none');
    expect(roleForCaregiver('someone-unknown')).toBe('none');

    expect(displayNameFor('caregiver-priya')).toBe('Priya');
    expect(displayNameFor('someone-unknown')).toBe('someone-unknown');

    expect(personaTokenFor('caregiver-tom')).toBe('demo-tom');
    expect(personaTokenFor('nobody')).toBeUndefined();
  });

  it('never marks a real persona as a guest', () => {
    for (const token of ['demo-priya', 'demo-tom', 'demo-elena']) {
      expect(resolveIdentity(`Bearer ${token}`).isGuest).toBe(false);
    }
  });
});