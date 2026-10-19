/**
 * `resolve_request` — "Priya, approve the change." Closes the loop that
 * `request_regimen_change` opens.
 *
 * `request_regimen_change` refuses an unauthorised request and leaves it
 * PENDING for an authorised caregiver. Until this counterpart existed, that
 * pending item had no way to be settled. Resolving is itself a plan change, so
 * it takes the same authority as making one — below `full` the caller gets a
 * structured refusal (a successful result), and NOTHING is written: the
 * request simply stays pending.
 *
 * Approving appends `authority.change_applied`; declining appends
 * `authority.change_declined`. Either way R5 stops reporting the request,
 * because the question it asks — "who can say yes?" — now has an answer. The
 * refusal itself stays in the audit log.
 */
import { decide } from '../authority.js';
import { displayNameFor } from '../identity.js';
import { fail, ok, type ToolContext } from './_shared.js';
import {
  ResolveRequestInput,
  ResolveRequestOutput,
  type ResolveRequestOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function resolveRequest(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = ResolveRequestInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'Resolving a request needs a requestId and a decision of approve or decline.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Call get_handoff to see the pending requests and their ids.'],
    });
  }

  const { requestId, decision, note } = parsed.data;
  const state = ctx.store.careState();
  const request = state.changeRequests.get(requestId);

  if (!request) {
    return fail({
      code: 'UNKNOWN_REQUEST',
      message: `No request '${requestId}' is in the record.`,
      missingFields: [],
      suggestedFollowUp: ['Call get_handoff to see the pending requests and their ids.'],
    });
  }

  // Resolving is a plan change: same authority model as making one.
  const authority = decide(ctx.identity.role, 'resolve_plan_change', ctx.asOf);
  if (!authority.allowed) {
    const payload: ResolveRequestOut = {
      status: 'refused',
      requestId,
      refusal: {
        code: authority.refusal.code,
        whoCan: authority.refusal.whoCan,
        sinceWhen: authority.refusal.sinceWhen,
      },
      message: `Only ${authority.refusal.whoCan} can approve or decline this request. It stays pending.`,
    };
    ResolveRequestOutput.parse(payload);
    return ok({ ...payload });
  }

  const medName = state.medications.get(request.medicationId)?.name.value ?? request.medicationId;
  const requester = displayNameFor(request.requesterId);

  // Settled once, settled forever: a second attempt is answered, never applied
  // twice. (`appliedChanges` and `declinedChanges` are both keyed by requestId.)
  const applied = state.appliedChanges.get(requestId);
  const declined = state.declinedChanges.get(requestId);
  if (applied || declined) {
    const decidedAs = applied ? 'approved' : 'declined';
    const payload: ResolveRequestOut = {
      status: 'already_decided',
      requestId,
      decidedAs,
      eventId: (applied ?? declined)!.eventId,
      message: `That request was already ${decidedAs}. Nothing was written.`,
    };
    ResolveRequestOutput.parse(payload);
    return ok({ ...payload });
  }

  if (decision === 'approve') {
    const [appliedEvent] = ctx.store.append([
      {
        type: 'authority.change_applied',
        payload: {
          personId: request.personId,
          medicationId: request.medicationId,
          requestId,
          appliedById: ctx.identity.caregiverId,
          ...(request.newDose === undefined ? {} : { newDose: request.newDose }),
          ...(request.newFrequency === undefined ? {} : { newFrequency: request.newFrequency }),
        },
        actorId: ctx.identity.caregiverId,
        actorRole: ctx.identity.role,
        // 'caregiver', not 'clinician': the deciding actor is a caregiver
        // exercising household authority. The audit shows exactly who.
        source: 'caregiver',
        ts: ctx.asOf,
      },
    ]);

    const payload: ResolveRequestOut = {
      status: 'approved',
      requestId,
      eventId: appliedEvent?.eventId ?? requestId,
      message: `Approved and recorded. ${requester}'s request about ${medName} is settled.`,
    };
    ResolveRequestOutput.parse(payload);
    return ok({ ...payload });
  }

  const [declinedEvent] = ctx.store.append([
    {
      type: 'authority.change_declined',
      payload: {
        personId: request.personId,
        medicationId: request.medicationId,
        requestId,
        declinedById: ctx.identity.caregiverId,
        ...(note === undefined ? {} : { reason: note }),
      },
      actorId: ctx.identity.caregiverId,
      actorRole: ctx.identity.role,
      source: 'caregiver',
      ts: ctx.asOf,
    },
  ]);

  const payload: ResolveRequestOut = {
    status: 'declined',
    requestId,
    eventId: declinedEvent?.eventId ?? requestId,
    message: `Declined and recorded. The request is settled; ${medName} stays as it is.`,
  };
  ResolveRequestOutput.parse(payload);
  return ok({ ...payload });
}
