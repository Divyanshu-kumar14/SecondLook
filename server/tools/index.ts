/**
 * Tool registry (Phase 3, tasks P3-1 / P3-7 / P3-8).
 *
 * Descriptions are written as CUSTOMER INTENTS WITH EXAMPLE PHRASES, because an
 * assistant selects tools from how a person actually speaks (PRD §8, P3-8).
 * "get_current_regimen" tells a model nothing; "What is Dad on?" tells it when
 * to call this.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CheckDoseInput,
  CheckDoseOutput,
  ExplainProblemInput,
  ExplainProblemOutput,
  FindProblemsInput,
  FindProblemsOutput,
  GetCurrentRegimenInput,
  GetCurrentRegimenOutput,
  GetHandoffInput,
  GetHandoffOutput,
  GetTimelineInput,
  GetTimelineOutput,
  RecordDoseInput,
  RecordDoseOutput,
  RequestRegimenChangeInput,
  RequestRegimenChangeOutput,
  ResolveRequestInput,
  ResolveRequestOutput,
} from '../schemas/tools.js';
import { identityFromHeaders, type HeaderBag, type ToolContext } from './_shared.js';
import { checkDose } from './check_dose.js';
import { explainProblem } from './explain_problem.js';
import { findProblemsTool } from './find_problems.js';
import { getCurrentRegimen } from './get_current_regimen.js';
import { getHandoff } from './get_handoff.js';
import { getTimeline } from './get_timeline.js';
import { recordDose } from './record_dose.js';
import { requestRegimenChange } from './request_regimen_change.js';
import { resolveRequest } from './resolve_request.js';
import type { Store } from '../store.js';


export interface RegisterOptions {
  store: Store;
  /** Frozen demo clock (PRD §7). Injected into every tool; never a wall clock. */
  asOf: string;
  personId: string;
}

/** Build the per-call context. Identity comes from the real request headers. */
export function contextFor(
  opts: RegisterOptions,
  headers: HeaderBag,
): ToolContext {
  return {
    store: opts.store,
    identity: identityFromHeaders(headers),
    asOf: opts.asOf,
    personId: opts.personId,
  };
}

export function registerAllTools(mcp: McpServer, opts: RegisterOptions): void {
  // Each tool receives the RAW arguments plus the real request headers, so
  // identity is resolved per call rather than captured per session.
  const bind =
    (run: (ctx: ToolContext, raw: unknown) => CallToolResult) =>
    (raw: unknown, extra: { requestInfo?: { headers?: HeaderBag } }): CallToolResult =>
      run(contextFor(opts, extra.requestInfo?.headers), raw);

  mcp.registerTool(
    'check_dose',
    {
      title: 'Check a dose against the recorded care plan',
      description:
        'Check whether giving a dose is consistent with the recorded care plan, WITHOUT ' +
        'recording it. Use this BEFORE any medication is given. It reports what the ' +
        'household recorded — it does not give medical advice and ships no dosage ' +
        'recommendation. Returns a verdict of OK, CAUTION or DO_NOT_GIVE with the ' +
        'reasons and what to do next. Example phrases: "Can Tom give Dad his ibuprofen?", ' +
        '"Is it safe to give the Tylenol now?", "Check the paracetamol before I give it". ' +
        'Writes nothing to the record.',
      inputSchema: shapeOf(CheckDoseInput),
      outputSchema: shapeOf(CheckDoseOutput),
    },
    bind(checkDose),
  );

  mcp.registerTool(
    'record_dose',
    {
      title: 'Record that a dose was given',
      description:
        'Record that a dose has ALREADY been given. This never refuses and never blocks — ' +
        'a dose that really happened must always be loggable by anyone, so it accepts and ' +
        'then flags anything concerning. Example phrases: "I gave Dad his Tylenol", ' +
        '"Tom gave the ibuprofen at two", "She had 500 mg of paracetamol at eight".',
      inputSchema: shapeOf(RecordDoseInput),
      outputSchema: shapeOf(RecordDoseOutput),
    },
    bind(recordDose),
  );

  mcp.registerTool(
    'request_regimen_change',
    {
      title: 'Ask to change a medication regimen',
      description:
        'Ask to change how a medication is given. Refusable, unlike record_dose: if the ' +
        'requester does not have authority, the change is refused, the refusal is ' +
        'recorded, and the request is left pending for an authorised caregiver to ' +
        'approve or decline with resolve_request. ' +
        'Example phrases: "Double Robert\'s acetaminophen", "Can we give the ibuprofen ' +
        'every four hours instead?", "She wants to change Dad\'s medication".',
      inputSchema: shapeOf(RequestRegimenChangeInput),
      outputSchema: shapeOf(RequestRegimenChangeOutput),
    },
    bind(requestRegimenChange),
  );

  mcp.registerTool(
    'resolve_request',
    {
      title: 'Approve or decline a pending regimen change',
      description:
        'Settle a request that was refused and left pending: approve it or decline it. ' +
        'Only a full-authority caregiver may decide. Approving records the decision in ' +
        'the audit log; declining leaves the regimen as it is. Either way the request ' +
        'stops being pending. Example phrases: "Priya, approve the change", ' +
        '"Allow the extra painkillers", "Say no to that request".',
      inputSchema: shapeOf(ResolveRequestInput),
      outputSchema: shapeOf(ResolveRequestOutput),
    },
    bind(resolveRequest),
  );

  mcp.registerTool(
    'get_current_regimen',
    {
      title: 'What medications is this person on?',
      description:
        'List the medications currently recorded for someone, with the dose, how often, ' +
        'whether it is active, and who recorded it. Example phrases: "What is Dad on?", ' +
        '"What medications does Robert have?", "Which pills is he taking?".',
      inputSchema: shapeOf(GetCurrentRegimenInput),
      outputSchema: shapeOf(GetCurrentRegimenOutput),
    },
    bind(getCurrentRegimen),
  );

  mcp.registerTool(
    'find_problems',
    {
      title: 'Check whether the care is going to plan',
      description:
        'The main check. Reports the problems found in the record — medications given that ' +
        'should not have been, dispense that does not match the prescription, doses too ' +
        'close together, and unauthorised changes. Returns what it looked at alongside ' +
        'what it found, so an empty result is never mistaken for reassurance. ' +
        'Example phrases: "Are we doing this right?", "Is anything wrong with Dad\'s ' +
        'medication?", "What problems are there with Robert\'s care?".',
      inputSchema: shapeOf(FindProblemsInput),
      outputSchema: shapeOf(FindProblemsOutput),
    },
    bind(findProblemsTool),
  );

  mcp.registerTool(
    'explain_problem',
    {
      title: 'Explain why a problem was flagged',
      description:
        'Explain one problem in detail: which rule raised it, how it was derived, and the ' +
        'individual records behind it, oldest first. Example phrases: "Why?", ' +
        '"Show me why", "What evidence is that?", "How did you work that out?".',
      inputSchema: shapeOf(ExplainProblemInput),
      outputSchema: shapeOf(ExplainProblemOutput),
    },
    bind(explainProblem),
  );

  mcp.registerTool(
    'get_timeline',
    {
      title: 'Who did what, and when',
      description:
        'List what was recorded and when, for one person. Filter by date, by who recorded ' +
        'it, or by type of event — filtering to "authority" events shows every change ' +
        'that was requested or refused, which is the audit log. ' +
        'Example phrases: "Who gave ibuprofen Friday?", "What happened on Tuesday?", ' +
        '"Show me the refusals".',
      inputSchema: shapeOf(GetTimelineInput),
      outputSchema: shapeOf(GetTimelineOutput),
    },
    bind(getTimeline),
  );

  mcp.registerTool(
    'get_handoff',
    {
      title: 'Hand the care situation over to another caregiver',
      description:
        'Produce a handover summary for another caregiver: the situation, the background, ' +
        'an assessment, a recommendation, and an explicit list of what is still unresolved ' +
        'and who must resolve it. The summary is only marked settled when nothing is ' +
        'outstanding. Example phrases: "Hand off to Priya", "Summarise this for Tom", ' +
        '"What does the next caregiver need to know?".',
      inputSchema: shapeOf(GetHandoffInput),
      outputSchema: shapeOf(GetHandoffOutput),
    },
    bind(getHandoff),
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * The SDK wants a Zod *shape* (a plain object of validators), not a Zod object.
 * Typing this as the SDK's own `ZodRawShapeCompat` keeps the compiler honest
 * about which schemas can actually be registered.
 */
function shapeOf(schema: { shape: ZodRawShapeCompat }): ZodRawShapeCompat {
  return schema.shape;
}
