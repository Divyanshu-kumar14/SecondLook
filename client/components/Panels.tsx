/**
 * Findings list (Phase 4, task P4-4) + protocol/latency panels (P4-6, P4-7).
 */
import type { Finding } from '../phrase.js';
import { EvidenceDrawer, type EvidenceItem } from './EvidenceDrawer.js';
import type { ConnectionInfo } from '../mcp.js';

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function FindingsList({
  findings,
  evidenceByFinding,
}: {
  findings: Finding[];
  evidenceByFinding: Record<string, EvidenceItem[]>;
}) {
  if (findings.length === 0) {
    return <p className="muted">Nothing was found in the records read.</p>;
  }
  return (
    <ol className="findings">
      {findings.map((finding, index) => (
        <li key={finding.findingId} className={`finding sev-${finding.severity}`}>
          <div className="finding-head">
            <span className="finding-index" aria-hidden="true">
              {index + 1}
            </span>
            <h3>{finding.what}</h3>
          </div>
          <p className="finding-meta">
            <span className={`pill pill-${finding.severity}`}>
              {SEVERITY_LABEL[finding.severity]}
            </span>
            <span className="pill pill-quiet">{finding.rules.join(' + ')}</span>
            {finding.acknowledged ? (
              <span className="pill pill-ack">Seen, not fixed</span>
            ) : null}
          </p>
          <EvidenceDrawer evidence={evidenceByFinding[finding.findingId] ?? []} />
        </li>
      ))}
    </ol>
  );
}

/** P4-6 · Latency HUD. Server round-trip per call, measured in the browser. */
export function LatencyHud({ samples }: { samples: number[] }) {
  if (samples.length === 0) return null;
  const last = samples[samples.length - 1]!;
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
  const worst = sorted[sorted.length - 1]!;
  return (
    <p className="latency" aria-live="polite">
      <strong>{last.toFixed(1)} ms</strong> last call · p95 {p95.toFixed(1)} ms · worst{' '}
      {worst.toFixed(1)} ms over {samples.length} call{samples.length === 1 ? '' : 's'}
    </p>
  );
}

/** P4-7 · Protocol Inspector — what the handshake actually negotiated. */
export function ProtocolInspector({ info }: { info: ConnectionInfo | null }) {
  if (!info) return <p className="muted">Not connected.</p>;
  return (
    <dl className="inspector">
      <div>
        <dt>Protocol</dt>
        <dd>{info.protocolVersion}</dd>
      </div>
      <div>
        <dt>Server</dt>
        <dd>
          {info.serverName} {info.serverVersion}
        </dd>
      </div>
      <div>
        <dt>Session</dt>
        <dd>
          <code>{info.sessionId ?? 'none'}</code>
        </dd>
      </div>
      <div>
        <dt>Tools</dt>
        <dd>{info.toolCount}</dd>
      </div>
    </dl>
  );
}

export function ToolList({ tools }: { tools: string[] }) {
  return (
    <ul className="tool-list">
      {tools.map((name) => (
        <li key={name}>
          <code>{name}</code>
        </li>
      ))}
    </ul>
  );
}