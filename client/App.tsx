/**
 * Second Look demo client (Phase 4).
 *
 * Talks REAL MCP to /mcp over the wire using the official SDK client. It never
 * reads the event log or the fold (DoD #6): every answer rendered here came back
 * from a tool call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { McpConnection, PERSONAS, type CallResult, type ConnectionInfo, type Persona } from './mcp.js';
import { EXAMPLES, route } from './router.js';
import { speakFinding, speakNoFindings, speakRecorded, speakRefusal, speakVerdict, type Finding } from './phrase.js';
import { EvidenceDrawer, type EvidenceItem } from './components/EvidenceDrawer.js';
import { FindingsList, LatencyHud, ProtocolInspector, ToolList } from './components/Panels.js';

interface Turn {
  id: number;
  who: 'you' | 'system';
  utterance?: string;
  spoken: string;
  tool?: string;
  ms?: number;
  findings?: Finding[];
  evidence?: Record<string, EvidenceItem[]>;
  note?: string;
  error?: boolean;
}

let turnSeq = 0;

export function App() {
  const [persona, setPersona] = useState<Persona>(PERSONAS[1]!);
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [latencies, setLatencies] = useState<number[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // ── connect (reconnects on persona change, so the handshake is visible) ──
  useEffect(() => {
    let cancelled = false;
    let active: McpConnection | null = null;
    setConnecting(true);
    setConnectionError(null);

    McpConnection.connect(persona.token)
      .then(async (conn) => {
        if (cancelled) {
          await conn.close();
          return;
        }
        active = conn;
        setConnection(conn);
        setInfo(conn.info);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConnectionError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });

    return () => {
      cancelled = true;
      void active?.close();
    };
  }, [persona]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns]);

  const push = useCallback((turn: Omit<Turn, 'id'>) => {
    setTurns((prev) => [...prev, { ...turn, id: ++turnSeq }]);
  }, []);

  /** Every rendered answer goes through a real tool call. */
  const call = useCallback(
    async (tool: string, args: Record<string, unknown>) => {
      if (!connection) throw new Error('Not connected to the MCP server.');
      const result: CallResult = await connection.call(tool, args);
      setLatencies((prev) => [...prev, result.ms]);
      return result;
    },
    [connection],
  );

  /**
   * Fetch the records behind each finding so the drawer can cite real ids.
   * Runs in parallel — sequential calls made the panel look empty for seconds.
   * Failures are surfaced rather than silently becoming "0 records", which is
   * exactly the kind of empty result this whole project refuses to present as
   * reassurance.
   */
  const loadEvidence = useCallback(
    async (findings: Finding[]): Promise<Record<string, EvidenceItem[]>> => {
      const results = await Promise.all(
        findings.map(async (finding) => {
          try {
            const r = await call('explain_problem', { findingId: finding.findingId });
            const detail = r.structured.evidenceDetail;
            if (!Array.isArray(detail)) {
              return [finding.findingId, []] as const;
            }
            return [finding.findingId, detail as EvidenceItem[]] as const;
          } catch {
            return [finding.findingId, []] as const;
          }
        }),
      );
      const merged: Record<string, EvidenceItem[]> = {};
      for (const [id, items] of results) merged[id] = [...items];
      return merged;
    },
    [call],
  );

  const ask = useCallback(
    async (line: string) => {
      const utterance = line.trim();
      if (!utterance || !connection) return;
      setBusy(true);
      setInput('');
      push({ who: 'you', utterance, spoken: '', tool: undefined });

      const routed = route(utterance, persona);

      // An unrecognised utterance does NOT silently become a different question.
      // Falling through to the headline check answered something nobody asked —
      // the same category of dishonesty as reporting no findings when none were
      // looked for. Ask instead, and say what is possible.
      if (routed.matched === null) {
        push({
          who: 'system',
          spoken:
            'I did not catch that as something I can check. Try one of the example phrases below, or type what you would like to know.',
          note: 'Simulated NLU matched no pattern, so no tool was called.',
        });
        setBusy(false);
        return;
      }

      try {
        const r = await call(routed.tool, routed.args);
        const s = r.structured;

        if (routed.tool === 'find_problems') {
          const findings = (s.findings as Finding[] | undefined) ?? [];
          const coverage = (s.coverage ?? {}) as { scannedEvents?: number; unloggedExpectedDoses?: number };
          const spoken =
            findings.length > 0
              ? findings.map((f) => speakFinding(f)).join(' ')
              : speakNoFindings(coverage.scannedEvents ?? 0, coverage.unloggedExpectedDoses ?? 0);
          setEvidenceLoading(true);
          push({
            who: 'system',
            spoken,
            tool: routed.tool,
            ms: r.ms,
            findings,
            evidence: await loadEvidence(findings),
            note: `Simulated NLU matched “${routed.matched}”.`,
          });
        } else if (routed.tool === 'check_dose') {
          push({
            who: 'system',
            spoken: speakVerdict(String(s.verdict), (s.reasons ?? []) as { ruleId: string }[]),
            tool: routed.tool,
            ms: r.ms,
          });
        } else if (routed.tool === 'record_dose') {
          push({
            who: 'system',
            spoken: speakRecorded(persona.name, (s.flags ?? []) as { ruleId: string }[]),
            tool: routed.tool,
            ms: r.ms,
          });
        } else if (routed.tool === 'request_regimen_change') {
          const refusal = s.refusal as { whoCan?: string } | undefined;
          push({
            who: 'system',
            spoken:
              s.status === 'refused'
                ? speakRefusal(refusal?.whoCan ?? 'an authorised carer')
                : 'The change was applied.',
            tool: routed.tool,
            ms: r.ms,
          });
        } else if (routed.tool === 'get_handoff') {
          const unresolved = (s.unresolved ?? []) as { item: string }[];
          const handoffTo = typeof s.for === 'string' ? s.for : 'the next carer';
          push({
            who: 'system',
            spoken: `Handing over to ${handoffTo}. ${unresolved.length} thing${unresolved.length === 1 ? '' : 's'} still open.`,
            tool: routed.tool,
            ms: r.ms,
          });
        } else if (routed.tool === 'get_timeline') {
          const events = (s.events ?? []) as { summary: string }[];
          push({
            who: 'system',
            spoken:
              events.length > 0
                ? `${events.length} record${events.length === 1 ? '' : 's'}. Most recent: ${events[events.length - 1]!.summary}.`
                : 'No matching records.',
            tool: routed.tool,
            ms: r.ms,
          });
        } else {
          const meds = (s.medications ?? []) as { name: string; status: string }[];
          push({
            who: 'system',
            spoken:
              meds.length > 0
                ? meds.map((m) => `${m.name}, ${m.status}`).join('. ') + '.'
                : 'Nothing is recorded.',
            tool: routed.tool,
            ms: r.ms,
          });
        }
      } catch (err: unknown) {
        push({
          who: 'system',
          spoken: err instanceof Error ? err.message : String(err),
          tool: routed.tool,
          error: true,
        });
      } finally {
        setBusy(false);
        setEvidenceLoading(false);
      }
    },
    [call, connection, loadEvidence, persona, push],
  );

  // Findings and their evidence must come from the SAME turn. Deriving them
  // from two independent searches let the panel show one turn's findings beside
  // another turn's evidence.
  const latestFindingTurn = [...turns].reverse().find((t) => t.findings);
  const latestFindings = latestFindingTurn?.findings;
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>Second Look</h1>
          <p className="tagline">Household care reconciliation.</p>
        </div>
        <nav aria-label="Who is speaking">
          <h2 className="visually-hidden">Persona</h2>
          <div className="personas" role="radiogroup" aria-label="Who is speaking">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={persona.id === p.id}
                className={`persona ${persona.id === p.id ? 'is-active' : ''}`}
                onClick={() => setPersona(p)}
              >
                <strong>{p.name}</strong>
                <span>{p.role}</span>
              </button>
            ))}
          </div>
          <p className="persona-blurb">{persona.blurb}</p>
        </nav>
      </header>

      {connectionError ? (
        <p role="alert" className="banner banner-error">
          Cannot reach the MCP server: {connectionError}
        </p>
      ) : null}

      <main className="layout">
        <section className="col col-main" aria-labelledby="talk-heading">
          <h2 id="talk-heading">Conversation</h2>

          <div
            className="transcript"
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation transcript"
          >
            {turns.length === 0 ? (
              <p className="muted">
                Ask a question, or pick one below. Everything shown here came back from a tool.
              </p>
            ) : (
              turns.map((turn) => (
                <article key={turn.id} className={`turn turn-${turn.who}`}>
                  <p className="turn-who">{turn.who === 'you' ? persona.name : 'Second Look'}</p>
                  {turn.utterance ? <p className="turn-utterance">“{turn.utterance}”</p> : null}
                  <p className={`turn-spoken${turn.error ? ' is-error' : ''}`}>{turn.spoken}</p>
                  {turn.tool ? (
                    <p className="turn-meta">
                      <code>{turn.tool}</code>
                      {turn.ms !== undefined ? <span>{turn.ms.toFixed(1)} ms</span> : null}
                    </p>
                  ) : null}
                  {turn.note ? <p className="turn-note muted">{turn.note}</p> : null}
                </article>
              ))
            )}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <label htmlFor="utterance" className="visually-hidden">
              What would you like to ask?
            </label>
            <input
              id="utterance"
              type="text"
              value={input}
              placeholder="Ask something, or type it yourself…"
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              disabled={busy || !connection}
            />
            <button type="submit" disabled={busy || !connection || input.trim() === ''}>
              {busy ? 'Asking…' : 'Ask'}
            </button>
          </form>

          <ul className="examples" aria-label="Example phrases">
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button type="button" onClick={() => void ask(ex.text)} disabled={busy || !connection}>
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="col col-side" aria-label="Details">
          <section aria-labelledby="findings-heading">
            <h2 id="findings-heading">Findings</h2>
            {latestFindings ? (
              <FindingsList
                findings={latestFindings}
                evidenceByFinding={latestFindingTurn?.evidence ?? {}}
                loading={evidenceLoading}
              />
            ) : (
              <p className="muted">Ask “Are we doing this right?” to see the findings.</p>
            )}
          </section>

          <section aria-labelledby="latency-heading">
            <h2 id="latency-heading">Latency</h2>
            <LatencyHud samples={latencies} />
          </section>

          <section aria-labelledby="inspector-heading">
            <h2 id="inspector-heading">Protocol</h2>
            {connecting ? <p className="muted">Connecting…</p> : <ProtocolInspector info={info} />}
            {info ? <ToolList tools={info.tools} /> : null}
          </section>

          <p className="disclaimer">
            Synthetic data. Not a medical device. Utterance routing and phrasing are
            <strong> simulated</strong> — Alexa+ generates its own.
          </p>
        </aside>
      </main>
    </div>
  );
}

export { EvidenceDrawer };