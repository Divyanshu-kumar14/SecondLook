/**
 * Findings list + live panels (Phase 4, tasks P4-4 / P4-6 / P4-7).
 *
 * Severity is carried by a tinted surface, a named label and a dot — never by a
 * thick coloured border, which reads as decoration rather than signal.
 */
import type { Finding } from '../phrase.js';
import { EvidenceDrawer, type EvidenceItem } from './EvidenceDrawer.js';
import type { ConnectionInfo } from '../mcp.js';
import { StaggeredList } from '../motion.js';

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_TEXT: Record<Finding['severity'], string> = {
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  low: 'text-low',
};

export function FindingsList({
  findings,
  evidenceByFinding,
  loading,
}: {
  findings: Finding[];
  evidenceByFinding: Record<string, EvidenceItem[]>;
  loading?: boolean;
}) {
  if (findings.length === 0) {
    return <p className="text-sm text-ink-faint">Nothing was found in the records read.</p>;
  }

  return (
    <StaggeredList count={findings.length}>
      {findings.map((finding, index) => {
        const has = Object.prototype.hasOwnProperty.call(evidenceByFinding, finding.findingId);
        const items = evidenceByFinding[finding.findingId] ?? [];
        return (
          <div
            className={`sev-${finding.severity} mb-3 rounded-card border border-rule p-4 last:mb-0`}
          >
            <div className="flex items-baseline gap-2">
              <span className="tnum text-xs text-ink-faint" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-[0.95rem] leading-snug font-medium text-balance">{finding.what}</h3>
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 text-[0.7rem] tracking-wide uppercase ${SEVERITY_TEXT[finding.severity]}`}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                {SEVERITY_LABEL[finding.severity]}
              </span>
              <span className="font-mono text-[0.7rem] text-ink-faint">
                {finding.rules.join(' · ')}
              </span>
              {finding.acknowledged ? (
                <span className="text-[0.7rem] tracking-wide text-trust uppercase">
                  Seen, not fixed
                </span>
              ) : null}
            </p>

            <EvidenceDrawer
              items={items}
              loading={loading === true && !has}
              failed={has && items.length === 0}
            />
          </div>
        );
      })}
    </StaggeredList>
  );
}

/** P4-6 · Latency HUD. Tabular figures so the column can be read down. */
export function LatencyHud({ samples }: { samples: number[] }) {
  if (samples.length === 0) return null;
  const last = samples[samples.length - 1]!;
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
  const worst = sorted[sorted.length - 1]!;

  return (
    <p className="tnum flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft" aria-live="polite">
      <span className="text-lg font-medium text-ink">{last.toFixed(1)} ms</span>
      <span>last call</span>
      <span className="text-ink-faint">·</span>
      <span>p95 {p95.toFixed(1)} ms</span>
      <span className="text-ink-faint">·</span>
      <span>worst {worst.toFixed(1)} ms</span>
      <span className="text-ink-faint">over {samples.length} call{samples.length === 1 ? '' : 's'}</span>
    </p>
  );
}

/** P4-7 · Protocol Inspector — what the handshake actually negotiated. */
export function ProtocolInspector({ info }: { info: ConnectionInfo | null }) {
  if (!info) return <p className="text-sm text-ink-faint">Not connected.</p>;
  return (
    <dl className="grid gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-faint">Protocol</dt>
        <dd className="tnum font-medium">{info.protocolVersion}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-faint">Server</dt>
        <dd className="font-medium">
          {info.serverName} {info.serverVersion}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-faint">Session</dt>
        <dd className="font-mono text-[0.7rem] break-all text-right">{info.sessionId ?? 'none'}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-faint">Tools</dt>
        <dd className="tnum font-medium">{info.toolCount}</dd>
      </div>
    </dl>
  );
}

export function ToolList({ tools }: { tools: string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-1.5">
      {tools.map((name) => (
        <li
          key={name}
          className="rounded border border-rule bg-paper px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-soft"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}