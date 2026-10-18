/**
 * Runtime configuration. Every value has a working default so that
 * `npm start` succeeds with ZERO environment variables (Phase 0 exit criterion).
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(
      `Invalid ${name}="${raw}": expected an integer in 1..65535. Refusing to start with a bad port.`,
    );
  }
  return parsed;
}

const host = process.env.HOST?.trim() || '127.0.0.1';
const port = intFromEnv('PORT', 8787);

/**
 * Dev origins are always permitted. The Vite dev server runs on :5173 while
 * the MCP server runs on :8787, so a dev-mode client is cross-origin by design
 * (plan decision D5). Binding stays on 127.0.0.1, so these are local-only.
 */
const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const extraOrigins = (process.env.SL_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Trusted host NAMES for DNS-rebinding defence. The port is appended per
 * request from the live socket (`allowedHostsFor` in mcp.ts), because the Host
 * header carries the port the server is *actually* bound to, which differs
 * from `config.port` whenever PORT is overridden or the server binds to :0.
 */
const allowedHostNames = [
  host,
  'localhost',
  '127.0.0.1',
  ...(process.env.SL_ALLOWED_HOSTS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []),
];

/**
 * Origins permitted for a server actually listening on `localPort`.
 *
 * The same reasoning as `allowedHostNames`: the `Origin` header of a
 * same-origin request carries the port the socket is bound to, not
 * `config.port`. DNS rebinding subverts the host name; the port is derived
 * from the trusted name, so deriving it live keeps the check strict without
 * breaking ephemeral-port binds (tests) or `PORT` overrides.
 */
export function originsForPort(localPort: number): string[] {
  return [
    ...new Set([
      `http://${host}:${localPort}`,
      `http://localhost:${localPort}`,
      ...devOrigins,
      ...extraOrigins,
    ]),
  ];
}

export const config = {
  host,
  port,
  /** Absolute path to the built client (Vite output). */
  clientDir: process.env.SL_CLIENT_DIR ?? 'dist/client',
  /** Absolute path to the append-only JSONL event log. */
  logFile: process.env.SL_LOG_FILE ?? '.data/events.jsonl',
  /**
   * `demo` truncates and re-seeds a byte-identical log on every boot (plan D4)
   * so every judge run and every recording is identical.
   */
  logMode: (process.env.SL_LOG_MODE ?? 'demo') as 'demo' | 'persist',
  allowedHostNames,
  devOrigins,
  extraOrigins,
  /**
   * PRD §9.2 requires the endpoint to support BOTH `application/json` and
   * `text/event-stream` responses. The SDK exposes this as a static flag
   * (`enableJsonResponse`), not per-request negotiation, so both modes are
   * supported and selectable. Default is SSE, which the demo client and MCP
   * Inspector both handle; set to `1` for plain JSON, which is friendlier to
   * minimal third-party clients (plan task P5-7).
   */
  jsonResponse: (process.env.SL_MCP_JSON_RESPONSE ?? '0') === '1',
  /** Defaults for the configured port; live lists are built per request. */
  allowedOrigins: originsForPort(port),
} as const;

export type Config = typeof config;