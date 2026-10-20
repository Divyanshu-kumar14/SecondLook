# P5-8 · Product feedback

This is a required submission artefact. One entry for each tool, API and SDK used in this project:
what it was for, what worked, what did not, how onboarding went, and whether we would build on it
again. All of it comes from work done on this project.

---

## `@modelcontextprotocol/sdk` 1.32.1

Used for: the whole server (`server/mcp.ts`) and the browser client (`client/mcp.ts`). Both speak
MCP through it.

What worked. The client transport worked well: `Client` + `StreamableHTTPClientTransport`
connected, negotiated a protocol version and called eight tools from inside a React component
without hand-written JSON-RPC. The UI is built on the typed result envelope (`CallToolResult` with
`structuredContent`). `zod` schemas convert to JSON Schema well enough that `tools/list` ships real
schemas with no extra work. `McpError` covers errors. Every protocol detail in §9 that we checked
was already handled.

What did not work. Three problems:

1. Response mode is fixed at construction by `enableJsonResponse`, with no per-request negotiation.
   PRD §9.2 asks for both modes, so supporting both means both configurations, selected by an
   environment variable (`SL_MCP_JSON_RESPONSE=1`). A client cannot ask per request. The SDK
   documents this, and the choice is reasonable, but it forced D22.

2. Schema failures never reach the handler, so they never reach the error shape. The SDK validates
   against `inputSchema` before invoking the handler. Our structured error contract therefore
   covers domain failures only; malformed arguments return the SDK's own `isError` message naming
   the field. One of the two paths is outside our control (D21).

3. The SDK owns the set of supported protocol versions. We wanted `2025-11-25` as the floor and
   could not pin it without hand-rolling the handshake, so negotiation is delegated to the SDK
   (D1).

Onboarding. Good for a transport, thin at the edges. The session lifecycle
(`initialize` → `mcp-session-id` → header on every later request → `DELETE` to terminate) is
correctly strict but is not the first thing the README shows. It cost us time to find that a
missing session id returns 400 rather than a helpful error. Would build again.

---

## `zod` 4.6.7

Used for: every tool input schema and the event schema in `server/schemas/events.ts`.

What worked. `z.discriminatedUnion` over the event types made the rules engine type-safe with zero
casts: narrowing on `event.type` narrows the payload. D15 records that choice. Zod 4 is a clear
improvement on the TypeScript side.

What did not work. Two problems, the second serious:

1. All references are inlined. The schema emitted for `tools/list` contains no `$defs`, no `$ref`
   and no `anyOf`; every union is expanded inline. The emitted JSON Schema is legal (`$schema`
   alone with no `$ref` is spec-compliant via `$catchall`), and Inspector renders it. A deeply
   nested union produces a large flat document.

2. Zod strips unknown keys without saying so. That is the default for object schemas, and it
   caused the most important bug in the project. Our hash-chain verifier ran every stored event
   through `EventSchema.safeParse` and then hashed the result. Because Zod strips unknown keys, a
   field injected into a stored event was dropped before hashing, and the chain reported the log
   intact. The verifier's message, "an edit to any byte changes that event hash", was false. We
   found it by running the tamper check; the fix hashes the raw parsed record (F30, D25).

   safeParse returns a valid value, not a copy of the input, so hashing its output verifies only
   the fields the schema kept.

Onboarding. Excellent. Error messages from `safeParse` name the failing path, and we surfaced them
directly in the MCP error payload. Would build again, but never hash or checksum a parsed schema
output.

---

## `express` 5.3.0

Used for: the HTTP layer in `server/index.ts` (static client, `/healthz`, `/mcp`).

What worked. Mounting the SDK's `StreamableHTTPServerTransport` on a real route, with our own
`Origin` and `Host` checks in front of it. Express 5's promise-aware error propagation meant async
handlers needed no wrapper middleware.

What did not work. Nothing blocked us. One ordering rule matters: the DNS-rebinding `Host` check
must run before the SDK transport, or the SDK answers 404 for a malformed `Host` before our 403
runs. That ordering is easy to break in a refactor.

Onboarding. Familiar. Would build again.

---

## React 19.3 + Vite 8.3 + `@vitejs/plugin-react`

Used for: the demo client.

What worked. The dev proxy with `changeOrigin: true` (D23). Vite 8 builds 678 modules in 337 ms.
React 19's concurrent rendering needed no accommodation; the client is simple enough that it did
not matter.

What did not work. Vite ships two prebuilt platform binaries (its bundler and CSS minifier) as
optional dependencies. Nothing compiles from source and the host needs no toolchain. Both are
glibc builds, so Alpine will not work (D24). The problem only shows up when you try to slim the
image, which is when it matters. The README states it.

Onboarding. Unproblematic. Would build again.

---

## Tailwind CSS 4.3 (`@tailwindcss/vite`)

Used for: the entire client styling layer.

What worked. The CSS-first configuration: tokens in `@theme`, utilities in the markup, no
`tailwind.config.js`. Container queries, `color-mix()` and `:has()` are available, and we used
them. Removing ~400 lines of hand-written CSS produced a smaller stylesheet (7.3 kB → 4.65 kB
gzipped), which we did not expect.

What did not work. Migration is not incremental in the way it looks. Moving a component from
bespoke CSS to utilities is a rewrite, and it took roughly a day. The design detector caught an
antipattern we would not have found by eye: a coloured `border-left` on cards, which it names as
the most recognisable tell of a generated interface. We had shipped it in two places and treated
it as a signal; it was decoration.

Onboarding. Good if you already know Tailwind. The `@theme` block is worth ten minutes of reading
before starting: tokens defined there make the dark-mode re-tint possible without touching a
component. Would build again.

---

## `motion` 14.3 (`motion/react`)

Used for: one authored moment, a new turn arriving and findings resolving in severity order.

What worked. `MotionConfig reducedMotion="user"` as a single root-level opt-out. That one line
handles reduced motion for the whole tree and does more than a per-component prop would. The
spring arrival settles fast without bouncing.

What did not work. ~45 kB gzipped for four animated components. `AnimatePresence` height
animations are the fussiest part of the API; `Expand` needed an explicit `exit` and an
`overflow-hidden` wrapper to stop the panel snapping shut.

We kept it because the work was opt-in and the demo was already verified, so the risk was bounded.
Would build again for an interface with more state transitions. For a page with four animated
elements, CSS alone would be less code and no dependency.

---

## Node.js 22+

Used for: everything.

What worked. Global `fetch` (used in the Dockerfile `HEALTHCHECK`), native `crypto` for the chain,
and no need for `--env-file`. The engines field is `>=22` and nothing required newer.

What did not work. npm 11 blocked `esbuild`'s postinstall behind an `allowScripts` prompt. The
build still works because the platform binary arrives through optional dependencies, but the
warning is noisy and will confuse a judge reading the install output.

Onboarding. Unproblematic. Would build again.

---

## Summary

| Dependency | Would build again? | The one thing to know |
|---|---|---|
| MCP SDK | Yes | You do not own the error contract for schema failures |
| Zod 4 | Yes | It strips unknown keys; never hash its output |
| Express 5 | Yes | Put the `Host`/`Origin` checks before the transport |
| React 19 + Vite 8 | Yes | Two prebuilt binaries; glibc only |
| Tailwind 4 | Yes | Moving off bespoke CSS is a rewrite; read `@theme` first |
| Motion | Yes, conditionally | `reducedMotion="user"` is worth it; the weight may not be |
| Node 22 | Yes | npm 11's `allowScripts` warning is noise, not failure |