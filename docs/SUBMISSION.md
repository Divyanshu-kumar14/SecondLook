# Devpost submission — copy and evidence map

This file is for the submission form, not the README. It stays short because a judge reads the
description field once.

## Description (submission field)

A systematic review of 54 studies found the median rate of medication errors after hospital
discharge was 53% in adults, and unintentional medication discrepancies 50% (Alqenae et al.,
*Drug Safety* 2020, doi:10.1007/s40264-020-00918-3). Second Look is a household care
reconciliation service for Alexa+ aimed at exactly that gap: the first weeks home, when several
carers record doses across paperwork that disagrees. It runs as a self-hosted MCP
server on spec 2025-11-25 over Streamable HTTP. It answers three questions from an append-only,
hash-chained record: is this dose consistent with the plan, are we doing this right, and what
still needs a human. There are nine MCP tools, one per customer intent, and each returns the event
ids behind its findings, so nothing is asserted without evidence. An empty result states what was
empty instead of "all clear". Recording a dose is never blocked. A plan change is refused as a
structured result, written to the audit log, and left as a pending request another carer can
approve. The client is built for a mid-crisis read: severity is carried by a tint, a named label
and a dot rather than colour alone, the evidence drawer tells loading from loaded from failed, and
reduced motion is honoured at both the Motion and CSS layers. An optional operator command anchors
the log in Amazon S3 Object Lock for an external, immutable copy. Built during the submission
window: 245 tests, 17/17 protocol conformance, MIT.

**Before → after.** Today, answering "was this dose consistent with the plan?" means reading every
carer's notes and holding the plan in your head; nothing that comes out of that reading carries the
rule it applied or the records it used. With Second Look it is one `check_dose` call, and the
result carries the verdict, the rule id and the event ids behind it; a plan change the caller has
no authority to make comes back as a refusal naming who can approve it, and that refusal is itself
in the audit log.

## Track and mini challenges

Primary track: Alexa+.

Mini challenges: **AWS Builder** — Amazon S3 Object Lock. A paste-ready answer for that field:

> AWS Builder — Amazon S3 Object Lock. `npm run anchor` verifies the SHA-256 hash chain, then
> uploads the exact event-log bytes plus a manifest (event count, head hash, file SHA-256, byte
> count, retention) to an S3 bucket with Object Lock enabled and per-object retention. `npm run
> verify-anchor` fetches those exact object versions back and proves the local log still contains
> the anchored head; new events after the anchor are allowed, a changed or truncated prefix fails.
> It is an operator command, off by default: the base demo makes no AWS calls. Implementation:
> `scripts/anchor.ts`, `scripts/verify-anchor.ts`, `server/anchor.ts`. Setup and live evidence:
> [README §Optional AWS anchor](../README.md#optional-aws-anchor).
>
> Live evidence, from the anchor receipt: 19 events anchored 2026-10-20, head hash `b4d8e855…`,
> file SHA-256 `0dc4f804d7c5d9b0dd5bab9c01d7543fc847357c9955f50a44f85e98749ce17f`, `GOVERNANCE`
> retention until 2026-11-19, bucket in `ap-southeast-2`. `npm run seed` re-seeds exactly that
> log, so `sha256sum .data/events.jsonl` reproduces that SHA-256 on a fresh clone: the bytes under
> Object Lock are the bytes this repository generates.

Open Source asks for a new, additional project or contribution alongside the
primary submission, and this repository is the primary submission.

## What each criterion is judged on, and where the evidence is

| Criterion | What we point to |
| --- | --- |
| **Tech Implementation** | 245 tests, 96.8 % line coverage on the rules, fold, log and authority paths; `npm run verify-protocol` 17/17 against a running server; append-only SHA-256 hash chain with a verifier that checks stored bytes; optional S3 Object Lock anchor with a verifier that fetches the anchored version and checks the local prefix; identity and authority resolved server-side, never from tool arguments. |
| **Design** | [`DESIGN.md`](../DESIGN.md). Re-checked in the running client on 2026-10-22, not just asserted: severity is carried by tint + named label + dot, measured on a critical and a high finding side by side (never colour alone); the evidence drawer renders loading, loaded and failed states; with the OS reduced-motion setting on, the page reports zero running animations and no transform; contrast pairs measure 4.92:1–17.61:1. `npm run verify-ui` passes 25/25. Screenshots in `docs/assets/`. |
| **Potential Impact** | The problem is bounded by evidence: a 54-study systematic review puts medication errors after discharge at a median 53% in adults (Alqenae et al., *Drug Safety* 2020, doi:10.1007/s40264-020-00918-3), and the Description states the before → after explicitly. The handover is an SBAR that names *who must resolve* each open item; every answer carries what it scanned. The deployment path below lists what is still missing for a real add-on. |
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

Deadline, confirmed on the live page 2026-10-22: **Oct 23, 2026, 3:00 pm EDT** (UTC−4, i.e.
19:00 UTC). "1 more day to deadline" was showing when this was checked. Submit before 18:00 EDT
to leave an hour for the form itself.

| Field | Source |
| --- | --- |
| Description | the block at the top of this file |
| Repository | `https://github.com/Divyanshu-kumar14/SecondLook` (public, MIT — both verified 2026-10-22) |
| Track | Alexa+ (primary) |
| Mini challenge | **AWS Builder** — paste the block under "Track and mini challenges", not just a README link |
| Product feedback | [`specs/PRODUCT-FEEDBACK.md`](../specs/PRODUCT-FEEDBACK.md) — must name which AWS services and how |
| Friction log | [`FRICTION-SUBMISSION.md`](../FRICTION-SUBMISSION.md) — up to 10% bonus |
| Pre-existing work | none, leave blank |

