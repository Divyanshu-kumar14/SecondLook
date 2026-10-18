/**
 * Shared tool plumbing (Phase 3, task P3-1).
 *
 * Two rules govern everything here:
 *   1. A REFUSAL IS A SUCCESSFUL RESULT, never an error (PRD §8).
 *   2. A stack trace NEVER crosses the wire (PRD §8).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GUEST, resolveIdentity, type Identity } from '../identity.js';
import type { Store } from '../store.js';
import type { ToolError } from '../schemas/tools.js';

export interface ToolContext {
  store: Store;
  /** Resolved server-side from the request's bearer token. Never client input. */
  identity: Identity;
  /** Frozen demo clock. Injected — the tool path never reads the wall clock. */
  asOf: string;
  /** The person this server is about. */
  personId: string;
}

export type HeaderBag =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null }
  | undefined;

function headerValue(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

/** Resolve identity from the real HTTP request headers. */
export function identityFromHeaders(headers: HeaderBag): Identity {
  return resolveIdentity(headerValue(headers, 'authorization'));
}

export const guestContext = (store: Store, asOf: string, personId: string): ToolContext => ({
  store,
  identity: GUEST,
  asOf,
  personId,
});

export function toolError(
  code: string,
  message: string,
  missingFields: string[] = [],
  suggestedFollowUp: string[] = [],
): ToolError {
  return { code, message, missingFields, suggestedFollowUp };
}

/**
 * Build a successful tool result: the same JSON in `structuredContent` (validated
 * against `outputSchema`) and in a `text` block (for spec compatibility).
 *
 * Used for BOTH normal results and refusals — a refusal is a success.
 */
export function ok<T extends Record<string, unknown>>(payload: T): CallToolResult {
  return {
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/** A genuine failure. `isError: true`, still a structured payload, never a stack. */
export function fail(error: ToolError): CallToolResult {
  return {
    isError: true,
    structuredContent: error,
    content: [{ type: 'text', text: JSON.stringify(error) }],
  };
}

/** Human-readable phrase for an ISO timestamp, shared by every tool. */
export function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}