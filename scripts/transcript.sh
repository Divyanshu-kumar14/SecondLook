#!/usr/bin/env bash
# P3-10 · Evidence capture. A paste-ready curl transcript:
#   initialize -> tools/list -> tools/call
# Usage: scripts/transcript.sh [--base http://127.0.0.1:8787]
set -euo pipefail

BASE="${2:-${1:-http://127.0.0.1:8787}}"
ACC='Accept: application/json, text/event-stream'

rpc() { curl -sS -X POST "$BASE/mcp" -H "$ACC" -H 'Content-Type: application/json' "$@"; }

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"transcript","version":"1.0"}}}'

echo '### 1. initialize'
SID=$(rpc -D - -o /tmp/opencode/.tx-init.json -H "Origin: $BASE" -d "$INIT" \
      | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')
if [ -z "$SID" ]; then echo "FAILED: no session id"; exit 1; fi
sed -n '1,20p' /tmp/opencode/.tx-init.json
echo "session: $SID"

echo
echo '### 2. tools/list'
rpc -H "mcp-session-id: $SID" -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | sed 's/^data: //' | grep -o '"name":"[a-z_]*"' | sort -u

echo
echo '### 3. tools/call — find_problems (guest, no token)'
rpc -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_problems","arguments":{"personId":"person-robert"}}}'

echo
echo '### 4. tools/call — check_dose for ibuprofen (DO_NOT_GIVE expected)'
rpc -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"check_dose","arguments":{"medicationId":"med-ibuprofen"}}}'

echo
echo '### 5. tools/call — request_regimen_change as Elena (refused)'
rpc -H "mcp-session-id: $SID" -H 'Authorization: Bearer demo-elena' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"request_regimen_change","arguments":{"medicationId":"med-acetaminophen","newFrequency":4,"reason":"He seems in more pain"}}}'

echo
echo '### 6. tools/call — get_timeline filtered to authority events (audit log)'
rpc -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_timeline","arguments":{"personId":"person-robert","type":"authority.*"}}}'

echo
echo '### 7. Origin rejection (expect 403)'
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/mcp" -H "$ACC" \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.com' -d "$INIT"