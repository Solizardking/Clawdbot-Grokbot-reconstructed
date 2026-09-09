#!/usr/bin/env bash
# Public discovery smoke for Cheshire Terminal (no secrets required).
set -euo pipefail

ORIGIN="${CHESHIRE_ORIGIN:-https://cheshireterminal.ai}"
failed=0
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/cheshire-api-smoke.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

check() {
  local name="$1" path="$2" expected="$3"
  local code
  local body="${tmp_dir}/body"
  code=$(curl -sS -o "$body" -w "%{http_code}" --max-time 20 "${ORIGIN}${path}" || echo "000")
  if [[ "$code" == "200" ]] && grep -Eq "$expected" "$body"; then
    echo "PASS  ${name} (${code})"
  else
    echo "FAIL  ${name} (${code}) ${path} — response did not match: ${expected}"
    failed=$((failed + 1))
  fi
}

echo "cheshire-api discovery smoke → ${ORIGIN}"
check "health" "/api/health" '"status"[[:space:]]*:[[:space:]]*"ok"'
check "developer status" "/api/developer/status" '"(status|endpoints|discovery)"'
check "openapi" "/api/developer/openapi.json" '"openapi"[[:space:]]*:[[:space:]]*"3\.'
check "llms.txt" "/api/developer/llms.txt" '(Cheshire|cheshire|/api/)'
check "agent configuration" "/.well-known/agent-configuration" '"(name|agent|interfaces|endpoints)"'
check "agent-card" "/.well-known/agent-card.json" '"(name|skills|capabilities)"'
check "mcp discovery" "/.well-known/mcp" '"(mcp|transport|endpoint|capabilities)"'
check "mcp server-card" "/.well-known/mcp/server-card.json" 'cheshire_api_discovery'

server_card="${tmp_dir}/server-card.json"
curl -fsS --max-time 20 "${ORIGIN}/.well-known/mcp/server-card.json" -o "$server_card" || true
tool_count=$(node -e 'const fs=require("fs");try{const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const tools=x.tools||x.capabilities?.tools||[];process.stdout.write(String(tools.length))}catch{process.stdout.write("0")}' "$server_card")
if [[ "$tool_count" == "12" ]]; then
  echo "PASS  mcp tool count (12)"
else
  echo "FAIL  mcp tool count (${tool_count}; expected 12)"
  failed=$((failed + 1))
fi

# Skills store is public in current app code; older deploys may still 401.
code_store=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "${ORIGIN}/api/skills-store" || echo "000")
if [[ "$code_store" == "200" ]]; then
  echo "PASS  skills-store (${code_store})"
  check "skills-store includes cheshire-api" "/api/skills-store" '"name"[[:space:]]*:[[:space:]]*"cheshire-api"'
  check "skills-store cheshire-api" "/api/skills-store/cheshire-api" '"validation"[[:space:]]*:'
  check "raw cheshire-api SKILL.md" "/api/skills-store/cheshire-api/SKILL.md" '^name: cheshire-api|^---'
elif [[ "$code_store" == "401" ]]; then
  echo "WARN  skills-store gated on this origin (redeploy app with isPublicSkillsPath)"
else
  echo "FAIL  skills-store (${code_store})"
  failed=$((failed + 1))
fi

echo ""
echo "Failed: ${failed}"
exit "${failed}"
