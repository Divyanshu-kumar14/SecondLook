/**
 * Evidence drawer (Phase 4, task P4-4).
 *
 * Lists the actual event ids behind a finding. Provenance is shown as
 * "recorded by Tom, from the discharge paper" — the actor is who RECORDED the
 * evidence, never who caused the problem. The wording enforces that.
 */
import { useId, useState } from 'react';

export interface EvidenceItem {
  eventId: string;
  ts?: string;
  type?: string;
  actorName?: string;
  source?: string;
  summary?: string;
}

const SOURCE_WORDS: Record<string, string> = {
  clinician: 'the clinical record',
  pharmacy: 'the pharmacy',
  caregiver: 'a caregiver',
  device: 'a device',
  document: 'the paperwork',
};

function provenanceLine(item: EvidenceItem): string {
  const who = item.actorName ?? 'someone';
  const where = SOURCE_WORDS[item.source ?? ''] ?? 'the record';
  return `recorded by ${who}, from ${where}`;
}

export function EvidenceDrawer({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="drawer">
      <button
        type="button"
        className="drawer-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} the {evidence.length} record
        {evidence.length === 1 ? '' : 's'} behind this
      </button>

      <div id={panelId} hidden={!open} className="drawer-panel">
        {evidence.length === 0 ? (
          <p className="muted">No records attached.</p>
        ) : (
          <ol className="evidence-list">
            {evidence.map((item) => (
              <li key={item.eventId}>
                <span className="evidence-summary">
                  {item.summary ?? item.type ?? 'event'}
                </span>
                <span className="evidence-prov">{provenanceLine(item)}</span>
                <code className="evidence-id">{item.eventId}</code>
                {item.ts ? <time dateTime={item.ts}>{item.ts.slice(0, 16).replace('T', ' ')}</time> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}