/**
 * `get_timeline` — "Who gave ibuprofen Friday?" (P3-2)
 *
 * Also serves as the audit log: `type: "authority.*"` filters to authority
 * events, which is how a refusal becomes visible after the fact.
 *
 * NOTE on `actorId` (plan D12, owner-approved): this is a READ-ONLY filter. It
 * cannot escalate privilege, because the caller already has unfiltered access
 * to the same timeline and the filter only narrows it. No tool accepts an
 * actorId that establishes WHO IS ACTING; `actorRole` is stamped server-side at
 * write time.
 */
import { displayNameFor } from '../identity.js';
import { fail, ok, when, type ToolContext } from './_shared.js';
import { GetTimelineInput, GetTimelineOutput, type GetTimelineOut } from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CareEvent } from '../schemas/events.js';

function belongsToPerson(event: CareEvent, personId: string): boolean {
  const payload = event.payload as { personId?: string };
  return payload.personId === personId;
}

export function getTimeline(ctx: ToolContext, raw: unknown): CallToolResult {
  const parsed = GetTimelineInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'personId is required.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask which person, e.g. "Who gave ibuprofen on Friday?"'],
    });
  }
  const { personId, from, to, actorId, type } = parsed.data;
  const fromMs = from === undefined ? undefined : Date.parse(from);
  const toMs = to === undefined ? undefined : Date.parse(to);

  const events = ctx.store
    .events()
    .filter((e) => belongsToPerson(e, personId))
    .filter((e) => (fromMs === undefined ? true : Date.parse(e.ts) >= fromMs))
    .filter((e) => (toMs === undefined ? true : Date.parse(e.ts) <= toMs))
    .filter((e) => (actorId === undefined ? true : e.actorId === actorId))
    // `authority.*` is a prefix match, which is what makes this an audit log.
    .filter((e) => (type === undefined ? true : type.endsWith('*') ? e.type.startsWith(type.slice(0, -1)) : e.type === type))
    .map((e) => ({
      eventId: e.eventId,
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      actorId: e.actorId,
      actorName: displayNameFor(e.actorId),
      actorRole: e.actorRole,
      source: e.source,
      summary: summarise(e),
      payload: e.payload,
    }));

  const payload: GetTimelineOut = { events };
  GetTimelineOutput.parse(payload);
  return ok(payload as unknown as Record<string, unknown>);
}

/**
 * One plain-language line per event. `event.payload` is referenced INSIDE each
 * case: hoisting it to a local would defeat discriminated-union narrowing,
 * because narrowing on `event.type` only narrows the `event` binding.
 */
function summarise(event: CareEvent): string {
  switch (event.type) {
    case 'dose.recorded':
      return `${event.payload.amountMg} mg of ${event.payload.medicationId} given`;
    case 'med.prescribed':
      return `${event.payload.doseMg} mg ${event.payload.form} of ${event.payload.name} prescribed, every ${event.payload.frequencyHours} h`;
    case 'med.discontinued':
      return `${event.payload.medicationId} stopped — ${event.payload.basis}${event.payload.prescriberConfirmed ? '' : ' (not prescriber-confirmed)'}`;
    case 'med.dispensed':
      return `${event.payload.doseMg} mg ${event.payload.form} dispensed for ${event.payload.medicationId}`;
    case 'authority.change_requested':
      return `${displayNameFor(event.payload.requesterId)} asked to change ${event.payload.medicationId}`;
    case 'authority.change_refused':
      return `change to ${event.payload.medicationId} refused — requester role ${event.payload.requesterRole}`;
    case 'authority.change_applied':
      return `change to ${event.payload.medicationId} applied by ${displayNameFor(event.payload.appliedById)}`;
    case 'authority.change_declined':
      return `change to ${event.payload.medicationId} declined by ${displayNameFor(event.payload.declinedById)}`;
    case 'problem.acknowledged':
      return `finding ${event.payload.findingId} acknowledged`;
    case 'plan.constraint_set':
      return `plan bars ${event.payload.barredClasses.join(', ')} — ${event.payload.reason}`;
    default:
      return event.type;
  }
}

export { when };