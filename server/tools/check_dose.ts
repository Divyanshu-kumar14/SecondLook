/**
 * `check_dose` — "Can Tom give Dad his ibuprofen?" (P3-3)
 *
 * A DRY RUN. It writes nothing, ever. The test asserts the log length is
 * unchanged after the call, because a "what if I gave this" question must never
 * become a record of giving it.
 *
 * Rather than re-implementing safety logic here, it PROJECTS a hypothetical
 * dose onto an in-memory copy of the events, folds that copy, and runs the real
 * rules engine over it. The same rules that judge the record judge the question.
 */
import { fold } from '../fold.js';
import { allRuleHits } from '../rules/index.js';
import { SEVERITY_RANK } from '../rules/types.js';
import { fail, ok, type ToolContext } from './_shared.js';
import {
  CheckDoseInput,
  CheckDoseOutput,
  type CheckDoseIn,
  type CheckDoseOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NewEventInput } from '../log.js';
import type { Severity } from '../schemas/events.js';

/** Placeholder id for the projected dose. Never leaves this module. */
const PROJECTED_ID = 'projected-dose-not-recorded';

export function checkDose(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = CheckDoseInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'medicationId is required.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask which medication, e.g. "Can Tom give Dad his ibuprofen?"'],
    });
  }
  const input: CheckDoseIn = parsed.data;
  const state = ctx.store.careState();
  const med = state.medications.get(input.medicationId);

  if (!med) {
    return fail({
      code: 'UNKNOWN_MEDICATION',
      message: `No medication '${input.medicationId}' appears in the record.`,
      missingFields: [],
      suggestedFollowUp: [
        'Call get_current_regimen to see what is actually on the list.',
        'Doses can only be checked against a recorded prescription.',
      ],
    });
  }

  const at = input.at ?? ctx.asOf;
  const amount = input.amount ?? med.doseMg.value;

  // Project onto a COPY. `log.append` is never called on this path.
  const hypothetical: NewEventInput = {
    type: 'dose.recorded',
    payload: { personId: med.personId, medicationId: med.id, amountMg: amount },
    actorId: ctx.identity.caregiverId,
    actorRole: ctx.identity.role,
    source: 'caregiver',
    ts: at,
    eventId: PROJECTED_ID,
  };

  const projected = fold([...ctx.store.events(), hypothetical as never]);
  const hits = allRuleHits(projected, at)
    .filter((h) => h.groupKey === med.id || h.medicationId === med.id)
    .filter((h) => Date.parse(h.when) <= Date.parse(at));

  const worst = hits.reduce<CheckDoseOut['verdict']>((acc, h) => {
    if (h.severity === 'critical') return 'DO_NOT_GIVE';
    if (h.severity === 'high' && acc !== 'DO_NOT_GIVE') return 'CAUTION';
    if (acc === 'OK') return 'CAUTION';
    return acc;
  }, 'OK');

  const topSeverity = hits.reduce<Severity>(
    (acc, h) => (SEVERITY_RANK[h.severity] > SEVERITY_RANK[acc] ? h.severity : acc),
    'low',
  );

  // The projected dose is the SUBJECT of the question, not evidence for it.
  // Its placeholder id must never reach a caller, because evidence is supposed
  // to be a set of real event ids a person could go and look up.
  const withoutProjection = (ids: string[]): string[] => ids.filter((id) => id !== PROJECTED_ID);

  const payload: CheckDoseOut = {
    verdict: worst,
    reasons: hits
      .filter((h) => h.severity === topSeverity || worst === 'DO_NOT_GIVE')
      .map((h) => ({ ruleId: h.ruleId, what: h.what, evidence: withoutProjection(h.evidence) })),
    nextAction: hits.find((h) => h.severity === topSeverity)?.nextAction ?? 'ACKNOWLEDGE',
  };

  CheckDoseOutput.parse(payload);
  return ok(payload as unknown as Record<string, unknown>);
}