# Devpost submission — copy and evidence map

This file is for the submission form, not the README. It stays short because a judge reads the
description field once.

## Description (submission field)

Second Look is a household care reconciliation service for Alexa+. It runs as a self-hosted MCP
server on spec 2025-11-25 over Streamable HTTP. When several carers record medications across
paperwork that disagrees, it answers three questions from an append-only, hash-chained record: is
this dose consistent with the plan, are we doing this right, and what still needs a human. There
are nine MCP tools, one per customer intent, and each returns the event ids behind its claims, so
nothing is asserted without evidence. An empty result states what was empty instead of
"all clear". Recording a dose is never blocked. A plan change is refused as a structured
result, written to the audit log, and left as a pending request another carer can approve. An
optional operator command anchors the log in Amazon S3 Object Lock for an external, immutable
copy. Built during the submission window: 244 tests, 17/17 protocol conformance, MIT.

## Track and mini challenges

Primary track: Alexa+.

Mini challenges: AWS Builder. The integration is Amazon S3 Object Lock:
`npm run anchor` uploads the exact event-log bytes and a manifest to a bucket
with Object Lock retention, and `npm run verify-anchor` fetches those versions
and proves the local log still contains the anchored head. It is an operator
command, off by default; the base demo makes no AWS calls. Setup and live
evidence: [README §Optional AWS anchor](../README.md#optional-aws-anchor).

Open Source asks for a new, additional project or contribution alongside the
primary submission, and this repository is the primary submission.

## What each criterion is judged on, and where the evidence is

| Criterion | What we point to |
| --- | --- |
| **Tech Implementation** | 244 tests, 96.8 % line coverage on the rules, fold, log and authority paths; `npm run verify-protocol` 17/17 against a running server; append-only SHA-256 hash chain with a verifier that checks stored bytes; optional S3 Object Lock anchor with a verifier that fetches the anchored version and checks the local prefix; identity and authority resolved server-side, never from tool arguments. |
| **Design** | [`DESIGN.md`](../DESIGN.md): severity carried by tint + named label + dot (never colour alone), reduced motion honoured at both the Motion and CSS layers, an evidence drawer with loading/loaded/failed states, tabular figures for anything compared down a column. Screenshots in `docs/assets/`. |
| **Potential Impact** | The problem is stated and bounded in the README; the handover is an SBAR that names *who must resolve* each open item; every answer carries what it scanned. The deployment path below lists what is still missing for a real add-on. |
| **Quality of the Idea** | The refusal → pending → approval loop: a refused plan change is a successful, renderable result that also writes an audit event and leaves work for someone with authority. Evidence ids on every claim. An unknown `personId` is refused with the id to use, so a typo can never read as "nothing is wrong". |

## Deployment path (what a real add-on needs)

None of this is implemented yet:

1. OAuth 2.1 authorization-code with PKCE (S256), with the `resource` parameter set to the
   server's canonical URI.
2. Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`;
   authorization-server metadata at `/.well-known/oauth-authorization-server`.
3. 401 without `WWW-Authenticate` on an unauthenticated request. The platform lists that header
   as *Not Supported Yet*, so sending the challenge breaks the handshake.
4. A reachable remote URL with sub-500 ms round trips, in place of the local `127.0.0.1` bind.
5. At rest: encryption for the local event log, and a deletion policy reconciled with
   append-only. The optional S3 anchor copies are SSE-S3 encrypted and under Object Lock; the
   local log is still plaintext.
6. Multiple people per record. Today the server is about one person; identity per speaker is
   a voice-profile concern the protocol does not expose.

## New build

Created 2026-10-18. Every commit falls inside the submission window (2026-08-31 to 2026-10-23),
and no project existed before it. The plan, PRD and decision records in `specs/` were written on
day one and kept current as the build went on, so the repository looks like a longer-running
project even though the history is five days.

## What we do not claim

- Not production-ready: no OAuth, no local-log encryption at rest, binds loopback by default.
- Not a medical device; all data is synthetic and generated in code.
- No Fire TV, Ring or Bee integration; this is an Alexa+ track entry. AWS is the optional,
  operator-run S3 Object Lock audit anchor, not a runtime dependency or a cryptographic
  signature.

## Field checklist

| Field | Source |
| --- | --- |
| Description | the block at the top of this file |
| Repository | `https://github.com/Divyanshu-kumar14/SecondLook` (public, MIT) |
| Demo video | public YouTube/Vimeo, English, under 3 minutes |
| Product feedback | [`specs/PRODUCT-FEEDBACK.md`](../specs/PRODUCT-FEEDBACK.md) |
| Friction log | [`FRICTION-SUBMISSION.md`](../FRICTION-SUBMISSION.md) |
| Track | Alexa+ |
| Pre-existing work | none, leave blank |
