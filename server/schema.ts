/**
 * JSON Schema hygiene (Phase 0, task P0-3 — plan decision D2).
 *
 * FINDING (spike-verified against @modelcontextprotocol/sdk@1.32.1 + zod@4.6.7):
 * the SDK converts Zod 4 shapes to JSON Schema itself and **inlines every
 * reference**. A deliberately hostile probe schema (reused sub-schemas, unions,
 * records, discriminated unions) emitted ZERO `$ref`, ZERO `$defs` and ZERO
 * `anyOf`. The single artefact left behind is one top-level
 * `$schema: "http://json-schema.org/draft-07/schema#"`.
 *
 * That key is SPEC-LEGAL: the SDK types `Tool.inputSchema` as
 * `z.core.$catchall<z.ZodUnknown>` (see types.d.ts), i.e. the MCP schema
 * explicitly permits extra keys beyond type/properties/required.
 *
 * Therefore: no downgrade to zod@3, and no reference-flattening is required.
 * `stripJsonSchemaMeta` still exists because we emit schemas ourselves in the
 * README transcript, in tests, and in Phase 3's evidence artefacts.
 */
import { z } from 'zod';

const META_KEYS: readonly string[] = ['$schema', '$id'];

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (META_KEYS.includes(key)) continue;
    out[key] = strip(entry);
  }
  return out;
}

/** Recursively remove JSON Schema meta keys. Does not mutate the input. */
export function stripJsonSchemaMeta<T>(schema: T): T {
  return strip(schema) as T;
}

/**
 * Convert a Zod 4 schema to a client-safe JSON Schema object.
 * Output is draft-2020-12 with meta keys stripped.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return stripJsonSchemaMeta(z.toJSONSchema(schema, { io: 'input' }));
}

/**
 * Cheap structural assertion used by tests to keep the claim in this file honest.
 */
export function assertNoReferences(schema: unknown): void {
  const text = JSON.stringify(schema);
  for (const token of ['$ref', '$defs', 'definitions']) {
    if (text.includes(`"${token}"`)) {
      throw new Error(
        `JSON Schema contains "${token}". The SDK is expected to inline all references ` +
          `(plan D2). Re-run the P0-3 spike before relaxing this assertion.`,
      );
    }
  }
}