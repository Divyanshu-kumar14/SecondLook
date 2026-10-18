/**
 * `record_dose` — "I gave Dad his Tylenol." (P3-6)
 *
 * ACCEPTS AND FLAGS. It never refuses (PRD §6.4): a real dose that happened must
 * always be loggable by anyone, including a guest. The flags returned are the
 * rules engine's verdict AFTER the write — so R6 surfaces an unauthorised dose
 * as a finding rather than as a blocked action.
 */
import { displayNameFor } from '../identity.js';
import { findProblems } from '../rules/index.js';
import { fail, ok, when, type ToolContext } from './_shared.js';
import {
  RecordDoseInput,
  RecordDoseOutput,
  type RecordDoseOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function recordDose(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = RecordDoseInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'A recorded dose needs a medication and an amount in milligrams.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask for the amount, e.g. "I gave Dad 500 mg of Tylenol."'],
    });
  }
  const { medicationId, amount, at, note } = parsed.data;
  const state = ctx.store.careState();
  const med = state.medications.get(medicationId);

  if (!med) {
    return fail({
      code: 'UNKNOWN_MEDICATION',
      message: `No medication '${medicationId}' appears in the record.`,
      missingFields: [],
      suggestedFollowUp: ['Call get_current_regimen first, then record against a real medication.'],
    });
  }

  const ts = at ?? ctx.asOf;

  // actorId/actorRole come from the resolved identity, never from the arguments.
  const [event] = ctx.store.append([
    {
      type: 'dose.recorded',
      payload: { personId: med.personId, medicationId: med.id, amountMg: amount },
      actorId: ctx.identity.caregiverId,
      actorRole: ctx.identity.role,
      source: 'caregiver',
      ts,
      ...(note === undefined ? {} : {}),
    },
  ]);

  if (!event) {
    // Fail loudly rather than returning a result with no event to point at.
    return fail({
      code: 'WRITE_FAILED',
      message: 'The dose could not be appended to the log.',
      missingFields: [],
      suggestedFollowUp: ['Check the event log is writable and retry.'],
    });
  }

  // Re-run the engine over the record INCLUDING the new dose.
  const after = ctx.store.careState();
  const flags = findProblems(after, ts)
    .filter((f) => f.medicationId === med.id)
    .filter((f) => f.evidence.includes(event.eventId))
    .flatMap((f) => f.rules.map((ruleId) => ({ ruleId, findingId: f.findingId })));

  const payload: RecordDoseOut = {
    recorded: true,
    eventId: event.eventId,
    provenance: {
      value: `${amount} mg of ${med.name.value}`,
      eventId: event.eventId,
      actorId: event.actorId,
      ts: event.ts,
      source: event.source,
    },
    flags,
    recordedBy: `${displayNameFor(event.actorId)} (role ${event.actorRole})`,
    recordedAt: when(ts),
  };

  // Parse the payload that actually ships — see F33.
  RecordDoseOutput.parse(payload);
  return ok({ ...payload });
}