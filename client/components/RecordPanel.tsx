/**
 * The record: findings, the audit log, and handover (P4-4 / P4-8 / P4-9).
 *
 * These are three views of the same evidence, so they share one column and are
 * switched rather than stacked — stacking all three would push the findings
 * below the fold on a laptop, which is the one thing this surface must not do.
 */
import { useEffect, useState } from 'react';
import type { CallResult } from '../mcp.js';
import { FindingsList } from './Panels.js';
import type { EvidenceItem } from './EvidenceDrawer.js';
import type { Finding } from '../phrase.js';
import { PERSON_ID } from '../router.js';

export type RecordView = 'findings' | 'audit' | 'handover';

const TABS: { id: RecordView; label: string }[] = [
  { id: 'findings', label: 'Problems' },
  { id: 'audit', label: 'Audit log' },
  { id: 'handover', label: 'Handover' },
];

interface AuditEvent {
  eventId: string;
  ts: string;
  type: string;
  actorName: string;
  actorRole: string;
  summary: string;
}

interface Handoff {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  settled: boolean;
  for?: string;
  unresolved: { item: string; kind: string; blocking: boolean; whoMustResolve: string }[];
}

export function RecordPanel({
  view,
  onViewChange,
  call,
  findings,
  evidenceByFinding,
  evidenceLoading,
}: {
  view: RecordView;
  onViewChange: (view: RecordView) => void;
  call: (name: string, args: Record<string, unknown>) => Promise<CallResult>;
  findings?: Finding[];
  evidenceByFinding: Record<string, EvidenceItem[]>;
  evidenceLoading: boolean;
}) {
  return (
    <section aria-labelledby="record-heading">
      <h2
        id="record-heading"
        className="mb-3 text-[0.72rem] font-medium tracking-[0.08em] text-ink-faint uppercase"
      >
        The record
      </h2>

      <div role="tablist" aria-label="Views of the record" className="mb-4 flex gap-1">
        {TABS.map((tab) => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onViewChange(tab.id)}
              className={`rounded-ctl px-3 py-1.5 text-[0.8rem] transition-colors duration-150 ${
                active
                  ? 'bg-ink text-paper'
                  : 'text-ink-soft hover:bg-paper-sunk hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${view}`}
        aria-labelledby={`tab-${view}`}
        tabIndex={-1}
      >
        {view === 'findings' ? (
          findings ? (
            <FindingsList
              findings={findings}
              evidenceByFinding={evidenceByFinding}
              loading={evidenceLoading}
            />
          ) : (
            <p className="text-sm text-ink-faint">
              Ask “Are we doing this right?” to see the problems.
            </p>
          )
        ) : null}

        {view === 'audit' ? <AuditLog call={call} /> : null}
        {view === 'handover' ? <HandoverPanel call={call} /> : null}
      </div>
    </section>
  );
}

/**
 * P4-8 · The audit log. Filtering the timeline to authority events turns it
 * into a record of what was asked for and who was allowed to change a regimen —
 * which is the only way a refusal stays visible after it was returned.
 */
function AuditLog({ call }: { call: (n: string, a: Record<string, unknown>) => Promise<CallResult> }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    call('get_timeline', { personId: PERSON_ID, type: 'authority.*' })
      .then((r) => {
        if (cancelled) return;
        setEvents((r.structured.events ?? []) as AuditEvent[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [call]);

  if (error) return <p className="text-sm text-critical">Could not load the audit log: {error}</p>;
  if (!events) return <p className="text-sm text-ink-faint">Loading the audit log…</p>;
  if (events.length === 0) {
    return <p className="text-sm text-ink-faint">No changes to a regimen have been requested.</p>;
  }

  return (
    <ol className="grid gap-2">
      {events.map((e) => (
        <li key={e.eventId} className="rounded border border-rule bg-card px-3 py-2">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[0.72rem] text-ink-faint">
            <time dateTime={e.ts} className="tnum">
              {e.ts.slice(5, 10)} {e.ts.slice(11, 16)}
            </time>
            <span className="font-mono">{e.type}</span>
          </p>
          <p className="mt-0.5 text-[0.82rem]">{e.summary}</p>
          <p className="mt-0.5 text-[0.72rem] text-ink-faint italic">
            recorded by {e.actorName}, role {e.actorRole}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * P4-9 · Handover. SBAR, plus an explicit list of what is still open and who
 * must resolve it. `settled` is false whenever anything is outstanding, and an
 * acknowledged problem is still outstanding — being seen is not being fixed.
 */
function HandoverPanel({ call }: { call: (n: string, a: Record<string, unknown>) => Promise<CallResult> }) {
  const [data, setData] = useState<Handoff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    call('get_handoff', { personId: PERSON_ID, toCaregiverId: 'caregiver-priya' })
      .then((r) => {
        if (cancelled) return;
        setData(r.structured as unknown as Handoff);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [call]);

  if (error) return <p className="text-sm text-critical">Could not build the handover: {error}</p>;
  if (!data) return <p className="text-sm text-ink-faint">Building the handover…</p>;

  return (
    <div className="grid gap-4">
      <div
        className={`rounded-card border px-3.5 py-3 ${
          data.settled ? 'border-trust/40 bg-trust/5' : 'border-critical/30 bg-critical-tint'
        }`}
      >
        <p className="text-[0.7rem] tracking-[0.08em] text-ink-faint uppercase">
          {data.settled ? 'Settled' : 'Not settled'}
        </p>
        <p className="mt-1 text-sm">{data.assessment}</p>
        {data.for ? <p className="mt-1 text-xs text-ink-faint">Prepared for {data.for}</p> : null}
      </div>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-[0.7rem] tracking-[0.08em] text-ink-faint uppercase">Situation</dt>
          <dd className="mt-0.5">{data.situation}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] tracking-[0.08em] text-ink-faint uppercase">Background</dt>
          <dd className="mt-0.5">{data.background}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] tracking-[0.08em] text-ink-faint uppercase">
            Recommendation
          </dt>
          <dd className="mt-0.5">{data.recommendation}</dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-2 text-[0.7rem] tracking-[0.08em] text-ink-faint uppercase">
          Still unresolved ({data.unresolved.length})
        </h3>
        {data.unresolved.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing outstanding.</p>
        ) : (
          <ol className="grid gap-2">
            {data.unresolved.map((item, i) => (
              <li
                key={i}
                className={`rounded border px-3 py-2 ${
                  item.blocking ? 'border-critical/30 bg-critical-tint' : 'border-rule bg-card'
                }`}
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-[0.72rem]">
                  <span className="tnum text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-mono text-ink-soft">{item.kind}</span>
                  {item.blocking ? (
                    <span className="text-critical">blocking</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[0.82rem]">{item.item}</p>
                <p className="mt-0.5 text-[0.72rem] text-ink-faint">
                  must be resolved by {item.whoMustResolve}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}