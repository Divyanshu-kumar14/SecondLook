# Friction log — submission extract

Written for the Devpost submission field, in the order and shape the field asks for:
**task attempted · steps · expected vs. actual · severity · workaround · actionable suggestion.**

Every entry below happened while building Second Look, and every one is traceable to the
long-form engineering log ([`FRICTION_LOG.md`](FRICTION_LOG.md)) or the decision record
([`DECISIONS.md`](DECISIONS.md)) by its id. Nothing here is reconstructed from documentation.

Severity scale as used on the submission form: **Critical** (blocked the integration) ·
**Important** (cost real time, has a clean fix) · **Nice-to-have** (papercut).

---

## 1. The SDK mints the session id during the `initialize` request, not during `connect()` — `@modelcontextprotocol/sdk` 1.32.1 — Important

**Task attempted.** Keep a handle on the transport so later requests on the same session could be routed to it.

**Steps.** Create `StreamableHTTPServerTransport`, call `server.connect(transport)`, store the transport in a module-scoped variable, clear the variable after `connect()` returns, then send `initialize` followed by `tools/list` on the returned session id.

**Expected.** The session is registered when `connect()` resolves, so the handle stored around it is live when the first request arrives.

**Actual.** `initialize` succeeded and returned a session id; the next request on that session failed:
```
[mcp] unhandled transport error: TypeError: Cannot read properties of undefined (reading 'handleRequest')
```
The session was recorded with `transport: undefined`: the id is minted *while handling the initialize request*, which happens after the variable had already been cleared.

**Workaround.** Capture `server` and `transport` in a per-request closure instead of a module-scoped handle, so the binding is live when the callback runs.

**Suggestion.** Document the callback ordering where `StreamableHTTPServerTransport` is introduced — "the session id exists only once the initialize request is handled" — and/or fire an `onsessioninitialized` callback before `handleRequest` returns. The type signature gives no hint that `connect()` is the wrong place to bind.

---

## 2. An unknown session id returns `400`, not `404` — `@modelcontextprotocol/sdk` 1.32.1 — Nice-to-have

**Task attempted.** Distinguish "request has no session header" from "request names a session this server does not know", and return 404 for the second.

**Steps.** `curl` a request with `mcp-session-id: not-a-real-session`.

**Expected.** `404 Session not found` — the id is well-formed but unknown.

**Actual.** `HTTP 400 Bad Request`, the same status as a missing header. A client cannot tell "start a new session" from "your session expired".

**Workaround.** Handle the distinction in the server before delegating to the transport; assert both branches in tests.

**Suggestion.** Return 404 for an unknown-but-present session id in the transport's default response, and reserve 400 for an absent one.

---

## 3. Response mode cannot be negotiated per request — `@modelcontextprotocol/sdk` 1.32.1 — Important

**Task attempted.** Serve both `text/event-stream` and `application/json` from one endpoint, choosing by what the client asks for.

**Steps.** Look for a per-request switch; try setting the mode on the transport after construction.

**Expected.** Honour the `Accept` header per request, as an HTTP endpoint normally would.

**Actual.** `enableJsonResponse` is a **static constructor flag**. "Supporting both" means running the server in one of two configurations, selected by an environment variable.

**Workaround.** Default to SSE (what the demo client and MCP Inspector handle) and expose `SL_MCP_JSON_RESPONSE=1` for plain JSON. Both modes are verified by the protocol sweep: 17/17 in SSE, 16/16 in JSON.

**Suggestion.** Let `enableJsonResponse` be decided per request from `Accept`, with the constructor value as the default. A server that can only be one thing at a time is harder to test against arbitrary clients.

---

## 4. Schema validation runs before the handler, so the server does not own half its error contract — `@modelcontextprotocol/sdk` 1.32.1 — Important

**Task attempted.** Return one structured error shape for every failure: `{code, message, missingFields[], suggestedFollowUp[]}`.

**Steps.** Call a tool with arguments that violate `inputSchema`.

**Expected.** The handler runs, catches the invalid input, and returns the same structured refusal the domain errors use.

**Actual.** The SDK answers first, with its own shape and no `structuredContent`:
```
MCP error -32602: Input validation error: Invalid arguments for tool find_problems:
Invalid input: expected string, received undefined at personId
```
So the server owns domain failures but not schema failures: two error contracts, one endpoint.

**Workaround.** Keep strict schemas (they are what `tools/list` advertises as `required`) and document the split. Both paths are asserted in the test suite.

**Suggestion.** Offer servers an opt-in to receive schema-validated-but-invalid arguments in the handler, so one error contract is possible. If that is rejected, state the split explicitly in the tool-authoring docs.

---

## 5. The supported protocol versions are hard-coded in the SDK, so a version floor cannot be configured — `@modelcontextprotocol/sdk` 1.32.1 — Nice-to-have

**Task attempted.** Require protocol `2025-11-25` or later, and reject older clients.

**Steps.** Look for a supported-versions option on the server or transport.

**Expected.** A configurable accepted-version set.

**Actual.** The set lives in the SDK:
```
LATEST_PROTOCOL_VERSION   = "2025-11-25"
SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]
```
Negotiation is delegated entirely; pinning a floor would mean hand-rolling the handshake. Here the SDK's latest happens to equal the required floor, which is luck rather than configuration.

**Workaround.** Recorded the SDK version as part of the contract and asserted the negotiated version in the protocol sweep.

**Suggestion.** Expose `supportedProtocolVersions` on the transport, defaulting to the current list.

---

## 6. An unauthenticated request must return 401 **without** `WWW-Authenticate` — Alexa+ MCP integration notes — Critical

**Task attempted.** Implement the authorization handshake for a remote MCP server.

**Steps.** Follow the usual OAuth protected-resource pattern: return 401 and advertise the authorization server in a `WWW-Authenticate` challenge.

**Expected.** The challenge starts the OAuth flow.

**Actual.** Per the platform notes, `WWW-Authenticate` is listed as *Not Supported Yet*; sending it breaks the handshake instead of starting it. The protected-resource metadata also belongs at the RFC 9728 well-known URI (`/.well-known/oauth-protected-resource`), not the older `/.well-known/oauth-authorization-server` path.

**Workaround.** This build ships no OAuth at all and publishes no authorization-server metadata — advertising auth it does not enforce would mislead clients. The correct shape is documented in the README instead.

**Suggestion.** State the "401 without `WWW-Authenticate`" rule next to the auth section of the MCP/agent docs, in the same place as the required `.well-known` path. It is the single easiest thing to get backwards, and getting it wrong fails at handshake time with no useful error.

---

## 7. `zod` strips unknown keys silently, which made a tamper check pass on a tampered log — `zod` 4.6.7 — Critical

**Task attempted.** Verify an append-only, hash-chained event log by re-parsing each stored line and hashing the result.

**Steps.** Parse every line with `EventSchema.safeParse`, hash the parsed object, compare against the stored hash.

**Expected.** Injecting an extra field into a stored event breaks the chain.

**Actual.** The verifier reported the log intact. `zod` object schemas discard unknown keys by default, so the injected field was removed *before* hashing — the verification hashed a projection, not the record. The verifier's own claim ("an edit to any byte changes that event hash") was false, and 205 tests plus the protocol sweep still passed.

**Workaround.** Hash the raw `JSON.parse` output, never a schema projection. Also fail on any field the schema does not declare.

**Suggestion.** Document the strip-unknown-keys default at the top of the object-schema docs, and consider a strict-by-default mode. A validation library's output is not a neutral representation of its input, and using it as one silently changes what a checksum sees.

---

## 8. Vite ships prebuilt glibc binaries, so the container cannot be Alpine — `vite` 8.3 / `@tailwindcss/vite` 4.3 — Nice-to-have

**Task attempted.** Build a small Alpine-based Node image for the demo.

**Steps.** Use `node:22-alpine`, run the documented build.

**Expected.** A ~60 MB smaller image; no native compilation either way.

**Actual.** The client build pulls two **prebuilt** platform binaries (the bundler and the CSS minifier). They are glibc builds and fail to load against musl, so the build dies with a linker error — from a `docker run`, on a machine that had followed the README exactly.

**Workaround.** `node:22-bookworm-slim`, and the requirement is stated in the README and the Dockerfile decision record.

**Suggestion.** Publish the libc requirement in the install/container docs, or ship musl builds for the prebuilt binaries.

---

## Feature requests

| Request | Why it matters | Urgency |
|---|---|---|
| Per-request response-mode negotiation (entry 3) | Lets one endpoint serve both SSE and JSON clients without a restart | Important |
| Configurable `supportedProtocolVersions` (entry 5) | A track that requires a minimum spec version needs to enforce it, not inherit it | Important |
| Opt-in handler-level schema errors (entry 4) | One error contract instead of two | Nice-to-have |
