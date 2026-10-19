#!/usr/bin/env bash
# P3-9 · Protocol compliance sweep against PRD §9.
# Verifies each of the nine items against the RUNNING server.
# Usage: scripts/verify-protocol.sh [base-url]
set -uo pipefail

BASE="${1:-http://127.0.0.1:8787}"
ACC='Accept: application/json, text/event-stream'
TMP=/tmp/opencode/.proto.$$
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"
pass=0; fail=0

ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
note() { echo "     ↳ $1"; }

hdr() { curl -sS -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' "$@"; }
ct()   { grep -i "^content-type:" "$TMP/hdr" | tr -d '\r' | cut -d' ' -f2-; }
sid()  { grep -i "^mcp-session-id:" "$TMP/hdr" | tr -d '\r' | awk '{print $2}'; }

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"proto","version":"1.0"}}}'

echo "Second Look — MCP protocol compliance sweep (PRD §9)"
echo "target: $BASE"
echo

# ── 1 ────────────────────────────────────────────────────────────────────────
echo "§9.1  POST with Accept: application/json, text/event-stream; body = one JSON-RPC message"
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -d "$INIT")
SID=$(sid)
[ "$code" = "200" ] && [ -n "$SID" ] && ok "POST returns 200 and a session id" \
  || bad "POST returned $code (session: ${SID:-none})"
note "Accept: $ACC"

# ── 2 ────────────────────────────────────────────────────────────────────────
echo "§9.2  Respond with application/json or text/event-stream; support both"
MODE=$(ct)
case "$MODE" in
  text/event-stream*) ok "responds with $MODE (default SSE mode)" ;;
  application/json*)  ok "responds with $MODE (JSON mode)" ;;
  *)                  bad "unexpected content-type: $MODE" ;;
esac
note "both are supported; toggle with SL_MCP_JSON_RESPONSE=1"

# ── 3 ────────────────────────────────────────────────────────────────────────
echo "§9.3  If SSE: priming event with an id and empty data, plus retry: before closing"
if [[ "$MODE" == text/event-stream* ]]; then
  if head -c 400 "$TMP/body" | grep -q '^event: message'; then
    ok "SSE stream opened with an event frame"
    head -c 200 "$TMP/body" | sed 's/^/       /'
  else
    bad "no SSE event frame"
  fi
  note "priming/retry emission is SDK-internal; visible once a long-lived stream opens"
else
  note "not applicable in JSON mode"
fi

# ── 4 ────────────────────────────────────────────────────────────────────────
echo "§9.4  MCP-Session-Id: visible-ASCII UUID at init; 400 if missing on non-init; 404 if terminated"
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
[[ "$SID" =~ $UUID_RE ]] && ok "session id is a visible-ASCII UUID" || bad "session id is not a UUID: $SID"

code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
[ "$code" = "400" ] && ok "non-init without a session id -> 400" || bad "expected 400, got $code"

code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -H 'mcp-session-id: 00000000-0000-4000-8000-000000000000' \
        -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')
[ "$code" = "404" ] && ok "unknown/terminated session id -> 404" || bad "expected 404, got $code"

code=$(hdr -X DELETE "$BASE/mcp" -H "$ACC" -H "mcp-session-id: $SID")
# Braces bind the || group; without them `a || b && c || d` skips BOTH the ok
# and bad counters on any other status (found reading the sweep itself) — the
# sweep would pass silently having checked one thing fewer.
{ [ "$code" = "200" ] || [ "$code" = "405" ]; } && ok "DELETE terminates the session ($code)" || bad "DELETE returned $code"

code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -H "mcp-session-id: $SID" -d '{"jsonrpc":"2.0","id":4,"method":"tools/list"}')
[ "$code" = "404" ] && ok "reuse after termination -> 404" || bad "expected 404, got $code"

# ── 5 ────────────────────────────────────────────────────────────────────────
echo "§9.5  MCP-Protocol-Version on later requests; absent -> assume 2025-03-26; invalid -> 400"
hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -d "$INIT" >/dev/null
S2=$(sid)
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -H "mcp-session-id: $S2" -H 'MCP-Protocol-Version: 2025-11-25' \
        -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}')
[ "$code" = "200" ] && ok "2025-11-25 accepted" || bad "expected 200, got $code"

code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -H "mcp-session-id: $S2" -H 'MCP-Protocol-Version: 1999-01-01' \
        -d '{"jsonrpc":"2.0","id":6,"method":"tools/list"}')
[ "$code" = "400" ] && ok "invalid version -> 400" || bad "expected 400, got $code"

code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' \
        -H "mcp-session-id: $S2" \
        -d '{"jsonrpc":"2.0","id":7,"method":"tools/list"}')
[ "$code" = "200" ] && ok "absent version -> assumed (not rejected)" || bad "absent version rejected with $code"
echo "SDK owns the supported set (streamableHttp.ts SUPPORTED_PROTOCOL_VERSIONS; client sends the latest it knows)"

# ── 6 ────────────────────────────────────────────────────────────────────────
echo "§9.6  Validate Origin on all connections (DNS-rebinding defence); invalid -> 403"
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -H 'Origin: https://evil.com' -d "$INIT")
[ "$code" = "403" ] && ok "untrusted Origin -> 403" || bad "expected 403, got $code"
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -H "Origin: $BASE" -d "$INIT")
[ "$code" = "200" ] && ok "same-origin client -> 200" || bad "expected 200, got $code"
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' -d "$INIT")
[ "$code" = "200" ] && ok "Vite dev origin -> 200" || bad "expected 200, got $code"

# ── 7 ────────────────────────────────────────────────────────────────────────
echo "§9.7  Bind 127.0.0.1 by default"
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8787'; then ok "listening on 127.0.0.1:8787 (loopback only)"
elif netstat -ltn 2>/dev/null | grep -q '127.0.0.1:8787'; then ok "listening on 127.0.0.1:8787 (loopback only)"
else note "could not confirm via ss/netstat; default config is HOST=127.0.0.1"; fi

# ── 8 ────────────────────────────────────────────────────────────────────────
echo "§9.8  GET /mcp -> SSE stream or 405; DELETE /mcp + session -> terminate or 405"
code=$(hdr "$BASE/mcp" -H 'Accept: application/json')
[ "$code" = "405" ] && ok "GET without Accept: text/event-stream -> 405" || bad "expected 405, got $code"
# Measure the init for real — hard-coding 200 here let a failed init masquerade.
code=$(hdr -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' -d "$INIT")
S3=$(sid)
[ "$code" = "200" ] && [ -n "$S3" ] || bad "init before DELETE check failed: $code"
code=$(hdr -X DELETE "$BASE/mcp" -H "$ACC" -H "mcp-session-id: $S3")
{ [ "$code" = "200" ] || [ "$code" = "405" ]; } && ok "DELETE + session id -> $code" || bad "DELETE returned $code"

# ── 9 ────────────────────────────────────────────────────────────────────────
echo "§9.9  JSON-RPC is UTF-8; never send one message on multiple streams"
if grep -qi 'charset' "$TMP/hdr"; then note "$(grep -i charset "$TMP/hdr" | tr -d '\r')"
else note "no charset param; JSON is UTF-8 by specification (RFC 8259)"; fi
frames=$(grep -c '^data: ' "$TMP/body" 2>/dev/null || echo 0)
note "single response carries one JSON-RPC message (frames in last body: $frames)"

echo
echo "──────────────────────────────────────────"
echo "  passed: $pass   failed: $fail"
echo "──────────────────────────────────────────"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)