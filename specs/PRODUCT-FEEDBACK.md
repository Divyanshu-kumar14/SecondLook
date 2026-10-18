# P5-8 · Product feedback

**Required submission artefact.** One entry per tool, API and SDK actually used in this project —
what it was for, what worked, what did not, how the onboarding was, and whether we would build on
it again. Everything below is drawn from work that actually happened; nothing here is a summary of
someone else's documentation.

---

## `@modelcontextprotocol/sdk` 1.32.1

**Used for:** the entire server (`server/mcp.ts`) and the browser client (`client/mcp.ts`). It is
the reason the demo is a real MCP server rather than a lookalike.

**What worked.** The client transport is genuinely good — `Client` + `StreamableHTTPClientTransport`
connected, negotiated a protocol version and called eight tools from inside a React component with
no hand-written JSON-RPC anywhere. The typed result envelope (`CallToolResult` with
`structuredContent`) is the feature the whole UI design rests on. `zod` schemas convert to JSON
Schema well enough that `tools/list` ships real schemas with no extra work. Error handling via
`McpError` is straightforward. Every protocol detail in §9 that we had to check turned out to be
already handled.

**What did not work.** Three things, all real:

1. **Response mode is a static constructor flag, not per-request negotiation.**
   `enableJsonResponse` is set once on the server. PRD §9.2 asks for support of *both* modes, so
   "supporting both" means supporting both *configurations*, selectable only by an environment
   variable (`SL_MCP_JSON_RESPONSE=1`). A client cannot ask per request. This is documented and
   reasonable, but it forced D22.

2. **Schema failures never reach your handler, so they never reach your error shape.** The SDK
   validates against `inputSchema` *before* invoking the handler. Our structured error contract
   therefore applies to **domain** failures only; malformed arguments return the SDK's own
   `isError` message naming the field. Both are graceful, but if you are designing an error
   contract, know that you do not own one of the two paths (**D21**).

3. **The supported protocol version set lives in the SDK, not in your config.** We wanted
   `2025-11-25` to be the floor and could not pin it without hand-rolling the handshake. We
   delegated negotiation to the SDK entirely rather than fight it (**D1**).

**Onboarding.** Good for a transport, thin on the edges. The session lifecycle
(`initialize` → `mcp-session-id` → header on every later request → `DELETE` to terminate) is
correctly strict but is not the first thing the README shows you, and it cost us real time to
discover that a missing session id returns 400 rather than a helpful error. **Would build again.**

---

## `zod` 4.6.7

**Used for:** every tool input schema and the event schema in `server/schemas/events.ts`.

**What worked.** `z.discriminatedUnion` over the event types made the whole rules engine type-safe
with **zero casts** — narrowing on `event.type` narrows the payload, and D15 is the decision to
lean on that rather than work around it. On the TypeScript side Zod 4 is a clear improvement.

**What did not work.** Two, and the second is the important one:

1. **All references are inlined.** The schema emitted for `tools/list` contains no `$defs`, no
   `$ref` and no `anyOf` — every union is expanded inline. The emitted JSON Schema is legal
   (`$schema` alone with no `$ref` is spec-compliant via `$catchall`), and Inspector renders it
   fine. But a deeply nested union produces a large flat document, and it is worth knowing
   before you design a schema around it.

2. **Zod strips unknown keys, silently.** This is the default for object schemas and it cost us
   the most important bug in the project. Our hash-chain verifier ran every stored event through
   `EventSchema.safeParse` and then hashed the *result*. Because Zod strips unknown keys, a field
   injected into a stored event was discarded **before hashing**, and the chain reported the log
   intact. The verifier's own message — "an edit to any byte changes that event hash" — was false.
   Found by running the tamper check instead of assuming it had been run before; fixed by hashing
   the raw parsed record (**F30**, **D25**).

   The lesson generalises past this project: **a validation library's default is not a neutral
   pass-through, and using its output as a representation of the input changes what your
   verification actually sees.**

**Onboarding.** Excellent. Error messages from `safeParse` name the failing path, and we surfaced
them directly in the MCP error payload. **Would build again — but never hash or checksum a parsed
schema output.**

---

## `express` 5.3.0

**Used for:** the HTTP layer in `server/index.ts` — static client, `/healthz`, `/mcp`.

**What worked.** Mounting the SDK's `StreamableHTTPServerTransport` on a real route with our own
`Origin` and `Host` checks in front of it. Express 5's promise-aware error propagation meant no
wrapper middleware for async handlers.

**What did not work.** Nothing that blocked us. The one sharp edge is ordering: the DNS-rebinding
`Host` check must run **before** the SDK transport, or the SDK answers 404 for a malformed
`Host` before our 403 ever gets a chance. That ordering is load-bearing and is easy to get wrong
on refactor.

**Onboarding.** Familiar, which is the point. **Would build again.**

---

## React 19.3 + Vite 8.3 + `@vitejs/plugin-react`

**Used for:** the demo client.

**What worked.** The dev proxy with `changeOrigin: true` (**D23**). Vite 8's build is 337 ms for
678 modules. The React 19 concurrent rendering model needed no accommodation — the client is
simple enough that it did not matter.

**What did not work.** Vite ships two **prebuilt platform binaries** (its bundler and CSS
minifier) as optional dependencies. Nothing compiles from source and no toolchain is needed on the
host, which is why it is acceptable — but they are glibc builds, so **Alpine will not work**
(**D24**). This is invisible until you try to slim the image, which is exactly when it is
annoying. We state it in the README rather than claim a purity we do not have.

**Onboarding.** Unproblematic. **Would build again.**

---

## Tailwind CSS 4.3 (`@tailwindcss/vite`)

**Used for:** the entire client styling layer.

**What worked.** The CSS-first configuration. Tokens in `@theme`, utilities in the markup, no
`tailwind.config.js`. Container queries, `color-mix()` and `:has()` are all available and we used
them. Removing ~400 lines of hand-written CSS produced a **smaller** stylesheet (7.3 kB → 4.65 kB
gzipped), which we did not expect going in.

**What did not work.** Migration is not incremental in the way it looks. Moving an existing
component from bespoke CSS to utilities is a rewrite, not an edit — this was roughly a day. And
the design detector caught an antipattern we would never have found by eye: a coloured
`border-left` on cards, which it names as the most recognisable tell of a generated interface. We
had shipped that pattern in two places and considered it a signal. It was decoration.

**Onboarding.** Good if you already know Tailwind. The `@theme` block is worth ten minutes of
reading before starting, because tokens defined there are what make the dark-mode re-tint possible
without touching a single component. **Would build again.**

---

## `motion` 14.3 (`motion/react`)

**Used for:** one authored moment — a new turn arriving, and findings resolving in severity order.

**What worked.** `MotionConfig reducedMotion="user"` as a single root-level opt-out. That one line
is a genuine accessibility win and does more than any per-component prop would. The spring-based
arrival settles fast and does not bounce.

**What did not work.** ~45 kB gzipped for what is, honestly, four animated components. And
`AnimatePresence` height animations are the fussiest part of the API — `Expand` needed an explicit
`exit` and an `overflow-hidden` wrapper to avoid the panel snapping shut.

We used it anyway, and the honest reason is worth stating: the work was opt-in and the demo was
already verified, so the risk was bounded. **Would build again** for an interface with more state
transitions; **would not** for a page with four animated elements, where CSS alone would be less
code and no dependency.

---

## Node.js 22+

**Used for:** everything.

**What worked.** Global `fetch` (used in the Dockerfile `HEALTHCHECK`), native `crypto` for the
chain, `--env-file` not needed. The engines field is `>=22` and nothing required newer.

**What did not work.** npm 11 blocked `esbuild`'s postinstall behind an `allowScripts` prompt. The
build still works because the platform binary arrives via optional dependencies, but the warning is
noisy and will confuse a judge reading install output.

**Onboarding.** Unproblematic. **Would build again.**

---

## Summary

| Dependency | Would build again? | The one thing to know |
|---|---|---|
| MCP SDK | **Yes** | You do not own the error contract for schema failures |
| Zod 4 | **Yes** | It **strips unknown keys** — never hash its output |
| Express 5 | **Yes** | Put the `Host`/`Origin` checks before the transport |
| React 19 + Vite 8 | **Yes** | Two prebuilt binaries; glibc only |
| Tailwind 4 | **Yes** | The rewrite is a rewrite; read `@theme` first |
| Motion | **Yes, conditionally** | `reducedMotion="user"` is worth it; the weight may not be |
| Node 22 | **Yes** | npm 11's `allowScripts` warning is noise, not failure |

The single most useful thing we learned came from a library behaving correctly according to its
documentation: Zod's job is to produce a *valid* value, not a faithful *copy* of the input, and
those are different things. We used its output to verify integrity, and it quietly removed the
evidence before we looked at it.