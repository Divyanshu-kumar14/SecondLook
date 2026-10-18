/**
 * Identity resolution (Phase 1, task P1-5).
 *
 * PRD §5.4: `Authorization: Bearer demo-priya | demo-tom | demo-elena`.
 * These are NON-SECRET demo personas seeded in the fixture and labelled as such.
 * NO token -> `guest` with role `none`, and the zero-config handshake still works.
 *
 * There is deliberately no OAuth server (PRD §10.3): advertising auth we do not
 * enforce misleads clients. See the README.
 */

export const ROLES = ['full', 'record', 'none'] as const;
export type RoleName = (typeof ROLES)[number];

export interface Identity {
  caregiverId: string;
  displayName: string;
  role: RoleName;
  /** True for the unauthenticated fallback. */
  isGuest: boolean;
}

export const GUEST: Identity = {
  caregiverId: 'guest',
  displayName: 'Guest',
  role: 'none',
  isGuest: true,
};

/** Static demo personas. Fixture source of truth, not a secret store. */
const PERSONAS: Readonly<Record<string, Identity>> = Object.freeze({
  'demo-priya': { caregiverId: 'caregiver-priya', displayName: 'Priya', role: 'full', isGuest: false },
  'demo-tom': { caregiverId: 'caregiver-tom', displayName: 'Tom', role: 'record', isGuest: false },
  'demo-elena': { caregiverId: 'caregiver-elena', displayName: 'Elena', role: 'none', isGuest: false },
});

/**
 * Resolve an `Authorization` header to an identity.
 * Never throws: a malformed or unknown token degrades to GUEST, so a client can
 * never crash the server or forge a role by sending garbage.
 */
export function resolveIdentity(authorizationHeader: string | undefined): Identity {
  if (!authorizationHeader) return GUEST;

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return GUEST;

  const token = match[1]!.trim().toLowerCase();
  return PERSONAS[token] ?? GUEST;
}

/** Map a caregiverId back to a role, for the fixture and handoff copy. */
export function roleForCaregiver(caregiverId: string): RoleName {
  for (const identity of Object.values(PERSONAS)) {
    if (identity.caregiverId === caregiverId) return identity.role;
  }
  return 'none';
}

export function personaTokenFor(caregiverId: string): string | undefined {
  for (const [token, identity] of Object.entries(PERSONAS)) {
    if (identity.caregiverId === caregiverId) return token;
  }
  return undefined;
}

export function displayNameFor(caregiverId: string): string {
  for (const identity of Object.values(PERSONAS)) {
    if (identity.caregiverId === caregiverId) return identity.displayName;
  }
  return caregiverId;
}