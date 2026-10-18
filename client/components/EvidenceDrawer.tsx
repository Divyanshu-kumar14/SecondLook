/**
 * Evidence drawer (Phase 4, task P4-4).
 *
 * Lists the actual event ids behind a finding. Provenance is written as
 * "recorded by Tom, from a caregiver" — the actor is who RECORDED the evidence,
 * never who caused the problem. The wording lives in one function so it cannot
 * drift into blame somewhere downstream.
 */
import { useId, useState } from 'react';
import { Expand } from '../motion.js';

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

export function EvidenceDrawer({
  items,
  loading,
  failed,
}: {
  items: EvidenceItem[];
  loading?: boolean;
  failed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const label = loading
    ? 'Looking up the records…'
    : failed
      ? 'No records could be loaded'
      : `Show the ${items.length} record${items.length === 1 ? '' : 's'} behind this`;

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={loading === true}
        disabled={loading === true}
        onClick={() => setOpen((v) => !v)}
        className="text-[0.8rem] text-trust underline decoration-trust/40 underline-offset-4 transition-colors hover:decoration-trust disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
      >
        {open ? 'Hide' : label}
      </button>

      <div id={panelId} hidden={!open}>
        <Expand open={open}>
          <div className="mt-2 rounded border border-rule bg-card p-3">
            {items.length === 0 ? (
              <p className="text-sm text-ink-faint">
                {loading ? 'Still loading…' : 'The records for this finding could not be loaded.'}
              </p>
            ) : (
              <ol className="grid gap-2.5">
                {items.map((item) => (
                  <li
                    key={item.eventId}
                    className="grid gap-0.5 border-b border-rule/60 pb-2.5 text-[0.8rem] last:border-b-0 last:pb-0"
                  >
                    <span className="font-medium">{item.summary ?? item.type ?? 'event'}</span>
                    <span className="text-ink-soft italic">{provenanceLine(item)}</span>
                    <span className="flex flex-wrap items-baseline gap-2">
                      <code className="font-mono text-[0.68rem] break-all text-ink-faint">
                        {item.eventId}
                      </code>
                      {item.ts ? (
                        <time
                          dateTime={item.ts}
                          className="tnum text-[0.68rem] text-ink-faint"
                        >
                          {item.ts.slice(0, 16).replace('T', ' ')}
                        </time>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Expand>
      </div>
    </div>
  );
}