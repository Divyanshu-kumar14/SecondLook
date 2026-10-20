/**
 * Shared tool schemas for the 9-tool MCP surface (PRD §8, Phase 0 task P0-5).
 * These are the single source of truth for `inputSchema` / `outputSchema`.
 *
 * IDENTITY INVARIANT (PRD §5.4, plan P1-6): no tool may accept an `actorId`
 * that establishes WHO IS ACTING. `actorRole` is resolved server-side at write
 * time. The single `actorId` in this file is a READ-ONLY FILTER on
 * `get_timeline` ("who gave ibuprofen Friday?"), sanctioned by PRD §8.
 * `toolsRejectActorIdentity()` in `tests/` enforces that invariant.
 */
import { z } from 'zod';
import { NextActionSchema, SeveritySchema } from './events.js';

// ── Shared error shape (PRD §8) — never a stack trace ─────────────────────────
export const ToolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  missingFields: z.array(z.string()),
  suggestedFollowUp: z.array(z.string()),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

const ProvenanceSchema = z.object({
  value: z.unknown(),
  eventId: z.string(),
  actorId: z.string(),
  ts: z.string(),
  source: z.string(),
});

// ── 1. check_dose — dry run, writes nothing ───────────────────────────────────
export const CheckDoseInput = z.object({
  medicationId: z.string().min(1),
  amount: z.number().positive().optional(),
  at: z.string().min(1).optional(),
});
export const CheckDoseOutput = z.object({
  verdict: z.enum(['OK', 'CAUTION', 'DO_NOT_GIVE']),
  reasons: z.array(
    z.object({
      ruleId: z.string(),
      what: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
  nextAction: NextActionSchema,
});
export type CheckDoseIn = z.infer<typeof CheckDoseInput>;
export type CheckDoseOut = z.infer<typeof CheckDoseOutput>;

// ── 2. record_dose — accepts and flags, NEVER refuses (PRD §6.4) ───────────────
export const RecordDoseInput = z.object({
  medicationId: z.string().min(1),
  amount: z.number().positive(),
  at: z.string().min(1).optional(),
  note: z.string().optional(),
});
export const RecordDoseOutput = z.object({
  recorded: z.literal(true),
  eventId: z.string(),
  provenance: ProvenanceSchema,
  flags: z.array(z.object({ ruleId: z.string(), findingId: z.string() })),
  // Returned by the handler but previously undeclared — same -32602 defect.
  recordedBy: z.string(),
  recordedAt: z.string(),
});
export type RecordDoseIn = z.infer<typeof RecordDoseInput>;
export type RecordDoseOut = z.infer<typeof RecordDoseOutput>;

// ── 3. request_regimen_change — refuses; a pending request remains (see 9) ────
export const RequestRegimenChangeInput = z.object({
  medicationId: z.string().min(1),
  newDose: z.number().positive().optional(),
  newFrequency: z.number().positive().optional(),
  reason: z.string().min(1),
});
export const RequestRegimenChangeOutput = z.object({
  status: z.enum(['applied', 'refused']),
  refusal: z
    .object({
      code: z.string(),
      whoCan: z.string(),
      sinceWhen: z.string().optional(),
    })
    .optional(),
  pendingRequestId: z.string().optional(),
  eventId: z.string(),
  // Returned ONLY on the refusal branch, and previously undeclared. This is the
  // demo's centrepiece: without it, every refusal threw at the client and the
  // UI rendered the raw protocol error as its answer.
  message: z.string().optional(),
});
export type RequestRegimenChangeIn = z.infer<typeof RequestRegimenChangeInput>;
export type RequestRegimenChangeOut = z.infer<typeof RequestRegimenChangeOutput>;

// ── 4. get_current_regimen ────────────────────────────────────────────────────
// `personId` is OPTIONAL on read tools: this server is about one person
// (`ToolContext.personId`), so omitting it is unambiguous. An assistant must not
// have to discover an internal id before it can answer a question.
export const GetCurrentRegimenInput = z.object({ personId: z.string().min(1).optional() });
export const GetCurrentRegimenOutput = z.object({
  medications: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dose: z.string(),
      frequency: z.string(),
      status: z.string(),
      provenance: z.array(ProvenanceSchema),
    }),
  ),
});
export type GetCurrentRegimenIn = z.infer<typeof GetCurrentRegimenInput>;
export type GetCurrentRegimenOut = z.infer<typeof GetCurrentRegimenOutput>;

// ── 5. find_problems — the headline tool ──────────────────────────────────────
export const FindProblemsInput = z.object({
  personId: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  minSeverity: SeveritySchema.optional(),
});
export const FindProblemsOutput = z.object({
  findings: z.array(
    z.object({
      findingId: z.string(),
      rules: z.array(z.string()),
      severity: SeveritySchema,
      what: z.string(),
      evidence: z.array(z.string()),
      when: z.string(),
      nextAction: NextActionSchema,
      acknowledged: z.boolean().optional(),
    }),
  ),
  coverage: z.object({
    scannedEvents: z.number().int().nonnegative(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    lastDoseAt: z.string().nullable(),
    unloggedExpectedDoses: z.number().int().nonnegative(),
  }),
  /** NEVER "all clear" (PRD §8). */
  assurance: z.enum(['NONE_FOUND_IN_RECORD', 'FINDINGS_PRESENT']),
});
export type FindProblemsIn = z.infer<typeof FindProblemsInput>;
export type FindProblemsOut = z.infer<typeof FindProblemsOutput>;

// ── 6. explain_problem ────────────────────────────────────────────────────────
export const ExplainProblemInput = z.object({ findingId: z.string().min(1) });
export const ExplainProblemOutput = z.object({
  rules: z.array(z.string()),
  derivation: z.array(z.string()),
  events: z.array(z.object({ eventId: z.string(), ts: z.string(), source: z.string() })),
  // The four below are returned by the handler but were missing here. A client
  // validates the WHOLE response against `outputSchema`, and these schemas are
  // strict (`additionalProperties: false`), so omitting them made every
  // `explain_problem` call fail at the client with -32602. See F33/D27.
  what: z.string(),
  /** Full event objects, not just ids — this is what the drawer renders. */
  evidenceDetail: z.array(z.unknown()),
  nextAction: NextActionSchema,
  acknowledged: z.boolean().optional(),
});
export type ExplainProblemIn = z.infer<typeof ExplainProblemInput>;
export type ExplainProblemOut = z.infer<typeof ExplainProblemOutput>;

// ── 7. get_timeline — also the audit log ──────────────────────────────────────
export const GetTimelineInput = z.object({
  personId: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  /** READ-ONLY filter, not an identity claim. See the invariant note above. */
  actorId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
});
export const GetTimelineOutput = z.object({ events: z.array(z.unknown()) });
export type GetTimelineIn = z.infer<typeof GetTimelineInput>;
export type GetTimelineOut = z.infer<typeof GetTimelineOutput>;

// ── 8. get_handoff — SBAR ─────────────────────────────────────────────────────
export const GetHandoffInput = z.object({
  personId: z.string().min(1).optional(),
  toCaregiverId: z.string().min(1),
});
export const GetHandoffOutput = z.object({
  situation: z.string(),
  background: z.string(),
  assessment: z.string(),
  recommendation: z.string(),
  settled: z.boolean(),
  unresolved: z.array(
    z.object({
      item: z.string(),
      kind: z.string(),
      blocking: z.boolean(),
      whoMustResolve: z.string(),
      evidence: z.array(z.string()),
      // Set only when the item is a finding someone has already seen. Being
      // acknowledged does NOT remove it from the handover — see F33.
      acknowledged: z.boolean().optional(),
    }),
  ),
  /**
   * Requests refused and left pending — settled by `resolve_request` (approve
   * or decline), never by acknowledgment. Empty once every request is decided.
   */
  pendingRequests: z.array(
    z.object({
      requestId: z.string(),
      medicationName: z.string(),
      requesterName: z.string(),
      requestedChange: z.string(),
      reason: z.string(),
      when: z.string(),
      whoCan: z.string(),
    }),
  ),
  // Returned by the handler but previously undeclared — same -32602 defect.
  for: z.string(),
  asOf: z.string(),
});
export type GetHandoffIn = z.infer<typeof GetHandoffInput>;
export type GetHandoffOut = z.infer<typeof GetHandoffOutput>;

// ── 9. resolve_request — settle a pending request (closes the refusal loop) ───
export const ResolveRequestInput = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['approve', 'decline']),
  note: z.string().min(1).optional(),
});
export const ResolveRequestOutput = z.object({
  status: z.enum(['approved', 'declined', 'refused', 'already_decided']),
  requestId: z.string(),
  /** The written event, on the two branches that write one. */
  eventId: z.string().optional(),
  /** On `already_decided`: which way it was settled. */
  decidedAs: z.enum(['approved', 'declined']).optional(),
  refusal: z
    .object({
      code: z.string(),
      whoCan: z.string(),
      sinceWhen: z.string().optional(),
    })
    .optional(),
  message: z.string(),
});
export type ResolveRequestIn = z.infer<typeof ResolveRequestInput>;
export type ResolveRequestOut = z.infer<typeof ResolveRequestOutput>;

export const TOOL_NAMES = [
  'check_dose',
  'record_dose',
  'request_regimen_change',
  'resolve_request',
  'get_current_regimen',
  'find_problems',
  'explain_problem',
  'get_timeline',
  'get_handoff',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Registry consumed by tests and by the Phase 3 tool registration. */
export const TOOL_CONTRACTS = {
  check_dose: { input: CheckDoseInput, output: CheckDoseOutput, mutates: false },
  record_dose: { input: RecordDoseInput, output: RecordDoseOutput, mutates: true },
  request_regimen_change: {
    input: RequestRegimenChangeInput,
    output: RequestRegimenChangeOutput,
    mutates: true,
  },
  resolve_request: {
    input: ResolveRequestInput,
    output: ResolveRequestOutput,
    mutates: true,
  },
  get_current_regimen: { input: GetCurrentRegimenInput, output: GetCurrentRegimenOutput, mutates: false },
  find_problems: { input: FindProblemsInput, output: FindProblemsOutput, mutates: false },
  explain_problem: { input: ExplainProblemInput, output: ExplainProblemOutput, mutates: false },
  get_timeline: { input: GetTimelineInput, output: GetTimelineOutput, mutates: false },
  get_handoff: { input: GetHandoffInput, output: GetHandoffOutput, mutates: false },
} as const satisfies Record<
  ToolName,
  { input: z.ZodType; output: z.ZodType; mutates: boolean }
>;

/** Tools that are allowed to write to the event log. */
export const WRITE_TOOLS = TOOL_NAMES.filter((n) => TOOL_CONTRACTS[n].mutates);

/** Tools that are allowed to refuse a caller. Only the authority tools, by design. */
export const REFUSING_TOOLS: readonly ToolName[] = ['request_regimen_change', 'resolve_request'];