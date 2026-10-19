/**
 * Second Look demo client (Phase 4).
 *
 * Talks REAL MCP to /mcp over the wire using the official SDK. It never reads
 * the event log or the fold (DoD #6): every answer rendered here came back from
 * a tool call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  McpConnection,
  PERSONAS,
  type CallResult,
  type ConnectionInfo,
  type Persona,
} from './mcp.ts';
import { EXAMPLES, route } from './router.ts';
import {
  speakFinding,
  speakNoFindings,
  speakRecorded,
  speakRefusal,
  speakVerdict,
  type Finding,
} from './phrase.ts';
import type { EvidenceItem } from './components/EvidenceDrawer.tsx';
import { LatencyHud, ProtocolInspector, ToolList } from './components/Panels.tsx';
import { RecordPanel, type RecordView } from './components/RecordPanel.tsx';
import { Crossfade, MotionProvider, Turn } from './motion.tsx';

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
  return (
    <MotionProvider>
      <Console />
    </MotionProvider>
  );
}

function Console() {
  const [persona, setPersona] = useState<Persona>(PERSONAS[1]!);
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [view, setView] = useState<RecordView>('findings');
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Connect, and reconnect on persona change so the handshake is visible and the
  // actor is resolved per request from the real Authorization header.
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
    const node = transcriptRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const push = useCallback((turn: Omit<Turn, 'id'>) => {
    setTurns((prev) => [...prev, { ...turn, id: ++turnSeq }]);
  }, []);

  const call = useCallback(
    async (tool: string, args: Record<string, unknown>) => {
      if (!connection) throw new Error('Not connected to the MCP server.');
      const result: CallResult = await connection.call(tool, args);
      setLatencies((prev) => [...prev, result.ms]);
      return result;
    },
    [connection],
  );

  const loadEvidence = useCallback(
    async (findings: Finding[]): Promise<Record<string, EvidenceItem[]>> => {
      // SEQUENTIAL, deliberately — do not "optimise" this into a Promise.all.
      //
      // The MCP SDK's StreamableHTTP client transport carries one SSE stream per
      // session. Firing several POSTs at once on it aborts all but one: verified
      // in the browser against the live server, where three concurrent
      // `explain_problem` calls were ERR_ABORTED while the same three requests
      // issued sequentially all returned 200 with full evidence. The server
      // handles concurrency fine (curl, three at once, all 200) — the loss is
      // entirely in the client transport, so serialising here is the fix.
      //
      // The cost is a few milliseconds: these calls are 0.1-1 ms server-side
      // and the user is reading a spoken answer while they resolve.
      const merged: Record<string, EvidenceItem[]> = {};
      for (const finding of findings) {
        try {
          const r = await call('explain_problem', { findingId: finding.findingId });
          const detail = r.structured.evidenceDetail;
          merged[finding.findingId] = Array.isArray(detail) ? [...(detail as EvidenceItem[])] : [];
        } catch {
          // Keep the key present with an empty list. The drawer distinguishes
          // "loaded and empty" from "failed to load", so this is not silent.
          merged[finding.findingId] = [];
        }
      }
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
      push({ who: 'you', utterance, spoken: '' });

      const routed = route(utterance, persona);

      // An unrecognised utterance does NOT silently become a different question.
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
          const coverage = (s.coverage ?? {}) as {
            scannedEvents?: number;
            unloggedExpectedDoses?: number;
          };
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
          const to = typeof s.for === 'string' ? s.for : 'the next carer';
          push({
            who: 'system',
            spoken: `Handing over to ${to}. ${unresolved.length} thing${unresolved.length === 1 ? '' : 's'} still open.`,
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
                ? `${meds.map((m) => `${m.name}, ${m.status}`).join('. ')}.`
                : 'Nothing is recorded.',
            tool: routed.tool,
            ms: r.ms,
          });
        }
      } catch (err: unknown) {
        push({
          who: 'system',
          spoken: err instanceof Error ? err.message : String(err),
          error: true,
        });
      } finally {
        setBusy(false);
        setEvidenceLoading(false);
      }
    },
    [call, connection, loadEvidence, persona, push],
  );

  // Findings and their evidence must come from the SAME turn.
  const latestFindingTurn = [...turns].reverse().find((t) => t.findings);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-rule py-6">
        <div>
          <h1 className="text-2xl tracking-tight text-balance sm:text-3xl">Second Look</h1>
          <p className="mt-1 text-ink-soft">Household care reconciliation.</p>
        </div>

        <nav aria-label="Who is speaking" className="min-w-0">
          <div
            role="radiogroup"
            aria-label="Who is speaking"
            className="flex flex-wrap gap-2"
          >
            {PERSONAS.map((p) => {
              const active = persona.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPersona(p)}
                  className={`flex flex-col items-start rounded-ctl border px-3 py-1.5 transition-colors duration-150 ${
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-rule-strong bg-card text-ink hover:border-ink'
                  }`}
                >
                  <span className="text-sm font-medium">{p.name}</span>
                  <span
                    className={`font-mono text-[0.7rem] ${active ? 'text-paper/70' : 'text-ink-faint'}`}
                  >
                    {p.role}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            <Crossfade value={persona.blurb}>{persona.blurb}</Crossfade>
          </p>
        </nav>
      </header>

      {connectionError ? (
        <p role="alert" className="mt-6 rounded border border-critical bg-critical-tint px-4 py-3 text-critical">
          Cannot reach the MCP server: {connectionError}
        </p>
      ) : null}

      <main className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="talk-heading">
          <h2
            id="talk-heading"
            className="mb-3 text-[0.72rem] font-medium tracking-[0.08em] text-ink-faint uppercase"
          >
            Conversation
          </h2>

          <div
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation transcript"
            className="h-[60vh] min-h-72 overflow-y-auto rounded-card border border-rule bg-card p-4 lg:h-96"
          >
            {turns.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Ask a question, or pick one below. Everything shown here came back from a tool.
              </p>
            ) : (
              <div className="grid gap-3">
                {turns.map((turn, i) => (
                  <Turn key={turn.id} index={i}>
                    {/* You and Second Look differ by surface and by the name
                        above, not by a coloured edge — an accent border is a
                        costume, and the speaker is already labelled. */}
                    <div
                      className={`rounded border border-rule px-3.5 py-3 ${
                        turn.who === 'you' ? 'bg-paper-sunk' : 'bg-card'
                      }`}
                    >
                      <p className="mb-1 text-[0.68rem] tracking-[0.08em] text-ink-faint uppercase">
                        {turn.who === 'you' ? persona.name : 'Second Look'}
                      </p>
                      {turn.utterance ? (
                        <p className="mb-1.5 text-ink-soft italic">“{turn.utterance}”</p>
                      ) : null}
                      <p className={turn.error ? 'text-critical' : 'text-ink'}>{turn.spoken}</p>
                      {turn.tool ? (
                        <p className="tnum mt-2 flex gap-3 text-[0.7rem] text-ink-faint">
                          <code className="font-mono">{turn.tool}</code>
                          {turn.ms !== undefined ? <span>{turn.ms.toFixed(1)} ms</span> : null}
                        </p>
                      ) : null}
                      {turn.note ? <p className="mt-1.5 text-[0.7rem] text-ink-faint">{turn.note}</p> : null}
                    </div>
                  </Turn>
                ))}
              </div>
            )}
          </div>

          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <label htmlFor="utterance" className="sr-only">
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
              className="min-w-0 flex-1 rounded-ctl border border-rule-strong bg-card px-3 py-2.5 text-ink placeholder:text-ink-faint focus-visible:border-trust disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !connection || input.trim() === ''}
              className="rounded-ctl bg-ink px-5 py-2.5 text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              {busy ? 'Asking…' : 'Ask'}
            </button>
          </form>

          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Example phrases">
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button
                  type="button"
                  onClick={() => void ask(ex.text)}
                  disabled={busy || !connection}
                  className="rounded-full border border-dashed border-rule-strong px-3 py-1 text-[0.78rem] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="grid gap-8 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1" aria-label="Details">
          <RecordPanel
            view={view}
            onViewChange={setView}
            call={call}
            canResolve={persona.role === 'full'}
            findings={latestFindingTurn?.findings}
            evidenceByFinding={latestFindingTurn?.evidence ?? {}}
            evidenceLoading={evidenceLoading}
          />

          <section aria-labelledby="latency-heading">
            <h2
              id="latency-heading"
              className="mb-2 text-[0.72rem] font-medium tracking-[0.08em] text-ink-faint uppercase"
            >
              Latency
            </h2>
            <LatencyHud samples={latencies} />
          </section>

          <section aria-labelledby="inspector-heading">
            <h2
              id="inspector-heading"
              className="mb-2 text-[0.72rem] font-medium tracking-[0.08em] text-ink-faint uppercase"
            >
              Protocol
            </h2>
            {connecting ? <p className="text-sm text-ink-faint">Connecting…</p> : <ProtocolInspector info={info} />}
            {info ? <ToolList tools={info.tools} /> : null}
          </section>

          <p className="border-t border-rule pt-4 text-[0.72rem] leading-relaxed text-ink-faint">
            Synthetic data. Not a medical device, and not a substitute for professional medical
            advice. Utterance routing and phrasing are{' '}
            <strong className="font-medium text-ink-soft">simulated</strong> — Alexa+ generates
            its own.
          </p>
        </aside>
      </main>
    </div>
  );
}