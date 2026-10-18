import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  sessions: number;
}

/**
 * Phase 0 skeleton (P0-7): proves the single Node process serves the built
 * client alongside /mcp. Real UI arrives in Phase 4.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/healthz', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Server responded ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <h1>Second Look</h1>
      <p className="tagline">Household care reconciliation for Alexa+.</p>

      <section aria-labelledby="phase-heading">
        <h2 id="phase-heading">Phase 0 — Foundations &amp; contracts</h2>
        <ul className="status">
          <li>
            <span className="dot" aria-hidden="true" />
            MCP endpoint at <code>/mcp</code> (Streamable HTTP)
          </li>
          <li>
            <span className="dot" aria-hidden="true" />
            Client served from this same process
          </li>
          <li>
            <span className="dot" aria-hidden="true" />
            100% synthetic data — not a medical device
          </li>
        </ul>
      </section>

      <section aria-labelledby="server-heading">
        <h2 id="server-heading">Server</h2>
        {health ? (
          <p data-testid="health">
            Online — <strong>{health.sessions}</strong> active MCP session
            {health.sessions === 1 ? '' : 's'}.
          </p>
        ) : error ? (
          <p data-testid="health-error" role="alert">
            Cannot reach the server: {error}
          </p>
        ) : (
          <p data-testid="health-pending">Contacting server…</p>
        )}
      </section>
    </main>
  );
}