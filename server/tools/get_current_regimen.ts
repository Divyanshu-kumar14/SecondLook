/**
 * `get_current_regimen` — "What is Dad on?" (P3-2)
 *
 * Read-only. Every medication carries its provenance so the caller can see WHO
 * recorded it and FROM WHERE, which is the difference between a list and an
 * account of it.
 */
import { displayNameFor } from '../identity.js';
import { fail, ok, when, type ToolContext } from './_shared.js';
import {
  GetCurrentRegimenInput,
  GetCurrentRegimenOutput,
  type GetCurrentRegimenOut,
} from '../schemas/tools.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function getCurrentRegimen(
  ctx: ToolContext,
  raw: unknown,
): CallToolResult {
  const parsed = GetCurrentRegimenInput.safeParse(raw);
  if (!parsed.success) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'personId is required.',
      missingFields: parsed.error.issues.map((i) => i.path.join('.')).filter(Boolean),
      suggestedFollowUp: ['Ask for the person this is about, e.g. "What is Dad on?"'],
    });
  }
  const { personId } = parsed.data;
  const state = ctx.store.careState();

  const medications = [...state.medications.values()]
    .filter((m) => m.personId === personId)
    .map((m) => {
      const provenance = [
        {
          value: `${m.doseMg.value} mg ${m.form.value}`,
          eventId: m.prescribedAt.eventId,
          actorId: m.prescribedAt.actorId,
          ts: m.prescribedAt.ts,
          source: m.prescribedAt.source,
        },
        ...(m.status.value === 'discontinued'
          ? [
              {
                value: `stopped ${when(m.status.provenance.ts)} by ${displayNameFor(m.status.provenance.actorId)}${m.discontinuedPrescriberConfirmed?.value ? '' : ' (not prescriber-confirmed)'}`,
                eventId: m.status.provenance.eventId,
                actorId: m.status.provenance.actorId,
                ts: m.status.provenance.ts,
                source: m.status.provenance.source,
              },
            ]
          : []),
      ];
      return {
        id: m.id,
        name: m.name.value,
        dose: `${m.doseMg.value} mg`,
        frequency: `every ${m.frequencyHours.value} h`,
        status: m.status.value,
        provenance,
      };
    });

  const payload: GetCurrentRegimenOut = { medications };
  GetCurrentRegimenOutput.parse(payload);
  return ok(payload);
}