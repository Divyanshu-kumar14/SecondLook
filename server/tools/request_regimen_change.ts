/**
 * `request_regimen_change` — "Double Robert's acetaminophen." (P3-6, DoD #4)
 *
 * THE ONLY REFUSING TOOL. DoD #4 requires all three of:
 *   1. the change is REFUSED
 *   2. the refusal is LOGGED as `authority.change_refused`
 *   3. a PENDING REQUEST is left for an authorised caregiver
 *
 * The refusal is a SUCCESSFUL result (PRD §8), not an error. `record_dose` must
 * never refuse, and this one must always produce all three outcomes.
 */
import { decidePlanChange } from '../authority.js';
import { displayNameFor } from '../identity.js';
import { fail, ok, type ToolContext } from './_shared.js';
import {
  RequestRegimenChangeInput,
  RequestRegimenChangeOutput,
  type RequestRegimenChangeOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function requestRegimenChange(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = RequestRegimenChangeInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'A regimen change needs a medication and a reason.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask why the change is wanted, e.g. "Double Robert\'s acetaminophen."'],
    });
  }
  const { medicationId, newDose, newFrequency, reason } = parsed.data;
  const state = ctx.store.careState();
  const med = state.medications.get(medicationId);

  if (!med) {
    return fail({
      code: 'UNKNOWN_MEDICATION',
      message: `No medication '${medicationId}' appears in the record.`,
      missingFields: [],
      suggestedFollowUp: ['Call get_current_regimen to see what is on the list.'],
    });
  }

  // Deterministic request id: the same request from the same actor at the same
  // clock produces the same id, so a retry does not create a second pending item.
  const requestId = `req-${ctx.identity.caregiverId}-${medicationId}-${ctx.asOf}`;

  ctx.store.append([
    {
      type: 'authority.change_requested',
      payload: {
        personId: med.personId,
        medicationId: med.id,
        requestId,
        requesterId: ctx.identity.caregiverId,
        ...(newDose === undefined ? {} : { newDose }),
        ...(newFrequency === undefined ? {} : { newFrequency }),
        reason,
      },
      actorId: ctx.identity.caregiverId,
      actorRole: ctx.identity.role,
      source: 'caregiver',
      ts: ctx.asOf,
    },
  ]);

  const decision = decidePlanChange(ctx.identity.role, ctx.asOf);

  if (decision.status === 'refused') {
    // (2) LOGGED — the refusal is itself an event, so it is auditable later.
    const [refusalEvent] = ctx.store.append([
      {
        type: 'authority.change_refused',
        payload: {
          personId: med.personId,
          medicationId: med.id,
          requestId,
          requesterId: ctx.identity.caregiverId,
          requesterRole: ctx.identity.role,
          whoCan: decision.refusal.whoCan,
        },
        actorId: ctx.identity.caregiverId,
        actorRole: ctx.identity.role,
        source: 'caregiver',
        ts: ctx.asOf,
      },
    ]);

    const payload: RequestRegimenChangeOut = {
      status: 'refused',
      refusal: {
        code: decision.refusal.code,
        whoCan: decision.refusal.whoCan,
        sinceWhen: decision.refusal.sinceWhen,
      },
      // (3) PENDING — left for an authorised caregiver to pick up.
      pendingRequestId: requestId,
      eventId: refusalEvent?.eventId ?? requestId,
      message:
        `${displayNameFor(ctx.identity.caregiverId)} cannot change the ${med.name.value} ` +
        `regimen. Only ${decision.refusal.whoCan} can. ` +
        `The request is now pending for them.`,
    };

    // Parse the payload that actually ships — see F33. This branch used to
    // append `message` AFTER validating, so every refusal failed at the client
    // with -32602 and the demo rendered a raw protocol error instead of a
    // refusal. It is the one result this whole project exists to get right.
    RequestRegimenChangeOutput.parse(payload);
    // A refusal is a SUCCESS, not an error.
    return ok({ ...payload });
  }

  const [appliedEvent] = ctx.store.append([
    {
      type: 'authority.change_applied',
      payload: {
        personId: med.personId,
        medicationId: med.id,
        requestId,
        appliedById: ctx.identity.caregiverId,
        ...(newDose === undefined ? {} : { newDose }),
        ...(newFrequency === undefined ? {} : { newFrequency }),
      },
      actorId: ctx.identity.caregiverId,
      actorRole: ctx.identity.role,
      source: 'clinician',
      ts: ctx.asOf,
    },
  ]);

  const payload: RequestRegimenChangeOut = {
    status: 'applied',
    eventId: appliedEvent?.eventId ?? requestId,
  };
  RequestRegimenChangeOutput.parse(payload);
  // Spread rather than cast. The cast here was hiding a real contract defect:
  // `ok()` takes `Record<string, unknown>`, an interface has no index signature,
  // and forcing it through with `as unknown as` meant nothing downstream could
  // notice the response no longer matched its declared schema (F33).
  return ok({ ...payload });
}