# P5-5 · Security review

Date: Sun 18 Oct 2026
Reviewer: the orchestrator. The plan names a `security-auditor` agent that does not exist in this
environment, and that gap is recorded here. This is a manual review against the plan's own
checklist. Every result below comes from a command that was run.

Verdict: no findings that block submission. Two limits are documented; fixing them is out of
scope.

---

## The plan's five checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Identity / authority surface | PASS | live matrix below |
| 2 | No secrets | PASS | secret-shaped grep across all tracked files: no hits |
| 3 | `.env.example` empty of values | PASS | 1202 bytes, 0 non-comment assignments |
| 4 | JSONL gitignored | PASS | no `.jsonl` tracked; `.data/` ignored (confirmed via `git check-ignore`) |
| 5 | No client-supplied `actorId` reachable | PASS | no tool schema declares `actorId`/`actorRole`; injection probe below |

---

## 1 · Authority surface

Identity resolves in `server/identity.ts` from the `Authorization` header only:

- `Bearer demo-priya` → role `full`
- `Bearer demo-tom` → role `record`
- `Bearer demo-elena` → role `none`
- anything else, malformed, or absent → `GUEST`, role `none`

`resolveIdentity` never throws, so a bad token cannot crash the server or forge a role; unknown
input resolves to the guest role.

### Live matrix — `request_regimen_change`, one request per row

```
demo-tom (role: record)                      status=refused  pending=req-caregiver-tom-…
demo-tom + INJECTED actorId/role/caregiver   status=refused  pending=req-caregiver-tom-…
demo-priya (role: full)                      status=applied
no Authorization header (guest)              status=refused  pending=req-guest-…
garbage token                                status=refused  pending=req-guest-…
wrong scheme (Basic, not Bearer)             status=refused  pending=req-guest-…
demo-elena (role: none)                      status=refused  pending=req-caregiver-elena-…
```

Row 2 is the important one. The request carried
`actorId: "caregiver-priya"`, `actorRole: "full"` and `caregiverId: "caregiver-priya"` in its
arguments. It was still refused, and the pending request is attributed to `caregiver-tom`, the
identity from the bearer token rather than the one the client asserted. The plan's fatal risk,
"Refusal rests on undefined identity", is closed by behaviour here.

### DoD #4 — refused, logged, and a pending request created

Every refusal above produced both a refusal event and a pending-request event. The audit trail
after the matrix:

```
authority.change_refused    | guest             | change to med-ibuprofen refused — requester role non…
authority.change_requested  | guest             | guest asked to change med-ibuprofen
…7 refusals, 16 authority events total…
```

None of the refusals was dropped, and none was attributed to the injected actor.

The hash chain stayed intact across all seven refused writes (19 → 33 events):

```
[verify-log] OK — 33 events, chain intact.
```

### Other controls verified in the same run

| Control | Evidence |
|---|---|
| Origin validation | `Origin: http://evil.example` → 403; loopback and Vite dev origins → 200 |
| DNS-rebinding allow-list | derived per request from `req.socket.localPort` (D13) |
| Loopback bind | `listening on 127.0.0.1:8787` (§9.7) |
| Session enforcement | non-init without a session → 400; unknown/terminated → 404 |
| Host header | validated against the live port, not the configured one (D13) |

---

## Two limits, stated rather than fixed

1 · The bearer tokens are public and labelled as demo personas.
`demo-priya` / `demo-tom` / `demo-elena` are seeded in the fixture and printed in the README. They
are not secrets; PRD §10.3 rules out advertising OAuth we do not enforce. On a real deployment this
is an open system: authority would come from the host platform's authenticated user context, not
from a header any client can set. The demo deliberately does not solve that, and the README says
so.

2 · A hash chain attests to integrity, not authorship. Anyone who can rewrite the whole log can
recompute every hash. Detecting edits works and is tested. Detecting a wholesale rewrite by a
writer would need signatures, which are out of scope for a local demo log and are not claimed in
the README.

---

## What would change before this handled real data

1. Real authentication from the Alexa+ host context, replacing the static persona table.
2. Signed events, or an external append-only anchor, to close limit 2.
3. Encryption at rest for a log containing medication and health data. Currently a plain JSONL.
4. A retention and deletion policy. Append-only and "never delete" are in direct tension, and
   that tension is unresolved.

Items 3 and 4 matter most, and neither is claimed as handled.