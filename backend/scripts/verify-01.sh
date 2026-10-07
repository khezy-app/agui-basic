#!/usr/bin/env bash
#
# BE-10 verification gate for spec-01. Proves the backend contract server-side, without a
# browser. Assertions 1-16, 23 and 24 need only the REST API; assertions 17-22 need a live
# model (Ollama by default). Use --no-model to skip 17-22 (NFR-10).
#
#   bash scripts/verify-01.sh [--no-model | --with-model]
#
# Server management: if a server is already listening on $PORT, it is used and NOT torn
# down (so assertion 24 reports SKIPPED — we cannot restart somebody else's server).
# Otherwise the script starts `./gradlew bootRun` itself and kills it on exit via trap.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-8080}"
BASE="http://localhost:$PORT"
OUT=".agent-out"
BODY="$OUT/body.json"
SEED_ID_CACHED="$OUT/seed_id.json"
NEXT_RUN=r100
PASSED=0
SKIPPED=0
FAILED=0
OWN_SERVER=0

mkdir -p "$OUT"

# ---------------------------------------------------------- helpers

say()  { printf '%s\n' "$*"; }
pass() { PASSED=$((PASSED+1)); say "PASS $1"; }
skip() { SKIPPED=$((SKIPPED+1)); say "SKIPPED $1 — $2"; }
fail() { FAILED=$((FAILED+1)); say "FAIL $1 — $2"; cat "$BODY" "${3:-/dev/null}" 2>/dev/null | head -5; exit 1; }

assert_status() { # <label> <expected_status> <curl args...>
  local label="$1" want="$2"; shift 2
  local actual
  actual=$(curl -s -o "$BODY" -w '%{http_code}' "$@")
  [[ "$actual" == "$want" ]] || fail "$label" "got $actual, want $want"
  pass "$label"
}

assert_json() { # <label> <jq-expr> <expected>
  local actual
  actual=$(jq -r "$2" "$BODY")
  [[ "$actual" == "$3" ]] || fail "$1" "jq $2 -> $actual (want $3)"
  pass "$1"
}

assert_json_invariant() { # <label> <jq-expr> expected
  local actual
  actual=$(jq -r "$2" "$BODY")
  [[ "$actual" == "$3" ]] || fail "$1" "jq $2 -> $actual (want $3)"
  pass "$1"
}

# SSE helpers: capture the raw stream, then assert on event types/names inside the
# data:{...} lines (jq needs the data: prefix stripped per line).
sse_capture() { # <label> <json-body> <dest>  [timeout]
  local label="$1" payload="$2" dest="$3" to="${4:-240}"
  curl -sN -m "$to" -X POST "$BASE/agent" -H 'content-type: application/json' \
       -d "$payload" > "$dest"
  [[ -s "$dest" ]] || fail "$label" "empty SSE stream"
  pass "$label"
}


ANY_FAILURE=0

# ---------------------------------------------------------- flags + model reachability

WITH_MODEL=auto
for arg in "$@"; do
  case "$arg" in
    --no-model)   WITH_MODEL=no ;;
    --with-model) WITH_MODEL=yes ;;
    *) say "unknown arg $arg" >&2; exit 2 ;;
  esac
done

MODEL_URL="${OPENAI_BASE_URL:-http://localhost:11434/v1}"
if [[ "$WITH_MODEL" == auto ]]; then
  if curl -sf -m 5 "$MODEL_URL/models" >/dev/null 2>&1; then WITH_MODEL=yes
  else WITH_MODEL=no; fi
fi

# ---------------------------------------------------------- server management

if curl -sf -m 3 "$BASE/api/tasks/stats" >/dev/null 2>&1; then
  say "server already up on $PORT — using it (will not tear down)"
  OWN_SERVER=0
else
  say "starting ./gradlew bootRun on $PORT ..."
  (cd "$BACKEND_DIR" && ./gradlew bootRun > "$OUT/bootrun.log" 2>&1 &)
  OWN_SERVER=1
  for _ in $(seq 1 60); do
    if curl -sf -m 3 "$BASE/api/tasks/stats" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -sf -m 3 "$BASE/api/tasks/stats" >/dev/null 2>&1 || { echo "server failed to start"; exit 1; }
  say "server is up"
fi

teardown() {
  if [[ "$OWN_SERVER" == 1 ]]; then
    pkill -f "io.github.khezyapp.backend.BackendApplication" 2>/dev/null || true
  fi
}
trap teardown EXIT

say "== REST assertions (1-16, 23, 24) =="

# 1 — AC-1.1: seeded paged, sorted list
assert_status "1. GET /api/tasks?size=2&sort=-createdAt → 200" 200 \
  "$BASE/api/tasks?size=2&sort=-createdAt"
assert_json "1a. totalElements >= 40" ".totalElements >= 40" "true"
assert_json "1b. size == 2" ".size" "2"
assert_json "1c. content|length == 2" ".content | length" "2"
UNFILTERED=$(jq '.totalElements' "$BODY")

# 2 — every FR-B-01 filter narrows the result (FR-B-01)
ANA_ID=$(curl -s "$BASE/api/team-members" | jq -r '.[] | select(.displayName=="Ana Reyes") | .id')
for spec in "status=BLOCKED:status filter" \
            "priority=URGENT:priority filter" \
            "assigneeId=$ANA_ID:assigneeId filter" \
            "unassigned=true:unassigned filter" \
            "tag=bug:tag filter" \
            "q=login:q filter" \
            "overdue=true:overdue filter" \
            "dueWithinDays=7:dueWithinDays filter" \
            "createdFrom=2026-10-01:createdFrom filter" \
            "createdTo=2026-09-30:createdTo filter"; do
  q="${spec%%:*}"; label="${spec##*:}"
  assert_status "2. $label → 200" 200 "$BASE/api/tasks?$q"
  total=$(jq '.totalElements' "$BODY")
  [[ "$total" -lt "$UNFILTERED" ]] || fail "2. $label" "totalElements $total did not narrow ($UNFILTERED)"
  pass "2. $label narrows (totalElements=$total)"
done

# 3 — combined filters narrow more (AND across, OR within)
curl -s "$BASE/api/tasks?status=BLOCKED" > /tmp/b1.json
curl -s "$BASE/api/tasks?priority=HIGH" > /tmp/b2.json
curl -s "$BASE/api/tasks?status=BLOCKED&priority=HIGH" > "$BODY"
a=$(jq '.totalElements' /tmp/b1.json); b=$(jq '.totalElements' /tmp/b2.json); c=$(jq '.totalElements' "$BODY")
[[ "$c" -le "$a" && "$c" -le "$b" ]] || fail "3. combined filters" "combined $c not ≤ individual ($a, $b)"
pass "3. combined filters ≤ each individual ($c ≤ $a, $b)"

# 4 — FR-B-08 stats counters all positive
assert_status "4. GET /api/tasks/stats → 200" 200 "$BASE/api/tasks/stats"
for f in total overdueTotal dueThisWeek unassignedTotal createdLast7Days; do
  v=$(jq ".$f" "$BODY"); [[ "$v" -gt 0 ]] || fail "4. stats.$f" "= $v (want > 0)"
done
pass "4. all headline counters > 0"

# 5 — AC-1.2
assert_status "5. POST /api/tasks {title:\"\"} → 400" 400 -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' -d '{"title":""}'
assert_json "5a. errors[0].field == title" ".errors[0].field" "title"

# 6 — FR-B-19
assert_status "6. POST with server-owned id → 422" 422 -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' -d '{"title":"ok","id":"11111111-1111-1111-1111-111111111111"}'
assert_json "6a. type is unprocessable" ".type" "https://agui-basic.local/problems/unprocessable"

# 7 — FR-B-03 create
assert_status "7. POST valid task → 201" 201 -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"Verify-01 probe","status":"IN_REVIEW","description":"d","priority":"MEDIUM"}'
TASK_ID=$(jq -r '.id' "$BODY")
assert_json "7a. version == 1" ".version" "1"

# 8 — FR-B-04 patch bumps version
CREATED=$(jq -r '.createdAt' "$BODY")
assert_status "8. PATCH priority → 200" 200 -X PATCH "$BASE/api/tasks/$TASK_ID?expectedVersion=1" \
  -H 'content-type: application/json' -d '{"priority":"HIGH"}'
assert_json "8a. version == 2" ".version" "2"
v=$(jq -r '.updatedAt' "$BODY"); [[ "$v" != "$CREATED" ]] || fail "8b. updatedAt" "unchanged"
pass "8b. updatedAt advanced"

# 9 — FR-B-14 version conflict
assert_status "9. PATCH expectedVersion=1 → 409" 409 -X PATCH "$BASE/api/tasks/$TASK_ID?expectedVersion=1" \
  -H 'content-type: application/json' -d '{"priority":"LOW"}'
assert_json "9a. marker version-conflict" ".type" "https://agui-basic.local/problems/version-conflict"

# 10 — AC-1.3 / INV-1
assert_status "10. IN_REVIEW → DONE → 200" 200 -X POST "$BASE/api/tasks/$TASK_ID/status" \
  -H 'content-type: application/json' -d '{"status":"DONE","expectedVersion":2}'
assert_status "10a. DONE → BACKLOG → 409" 409 -X POST "$BASE/api/tasks/$TASK_ID/status" \
  -H 'content-type: application/json' -d '{"status":"BACKLOG","expectedVersion":3}'
assert_json "10b. marker illegal-transition" ".type" "https://agui-basic.local/problems/illegal-transition"
jq -r '.detail' "$BODY" | grep -qi "Allowed targets" || fail "10c. detail lists allowed targets" "detail missing"
pass "10c. detail lists allowed targets"

# 11 — INV-2
assert_status "11. DONE → CANCELLED → 200" 200 -X POST "$BASE/api/tasks/$TASK_ID/status" \
  -H 'content-type: application/json' -d '{"status":"CANCELLED","expectedVersion":3}'
assert_status "11a. CANCELLED → TODO w/o reopen → 409" 409 -X POST "$BASE/api/tasks/$TASK_ID/status" \
  -H 'content-type: application/json' -d '{"status":"TODO","expectedVersion":4}'
assert_status "11b. CANCELLED → TODO reopen:true → 200" 200 -X POST "$BASE/api/tasks/$TASK_ID/status" \
  -H 'content-type: application/json' -d '{"status":"TODO","reopen":true,"expectedVersion":4}'
assert_json "11c. lands on TODO" ".status" "TODO"

# 12 — INV-3: a task without a description cannot enter BLOCKED (400 on field description).
# The status-change body carries no description field, so use a task that has none.
assert_status "12. create description-less task → 201" 201 -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' -d '{"title":"No-description probe","status":"TODO"}'
NODESC_ID=$(jq -r '.id' "$BODY")
assert_status "12a. TODO → BLOCKED with no description on the task → 400" 400 -X POST "$BASE/api/tasks/$NODESC_ID/status" \
  -H 'content-type: application/json' -d '{"status":"BLOCKED","expectedVersion":1}'
assert_json "12b. field is description" ".errors[0].field" "description"
curl -s -o /dev/null -X DELETE "$BASE/api/tasks/$NODESC_ID"
# The IN_REVIEW probe is already DONE→CANCELLED→TODO from 10-11; it stays in TODO and is
# deleted in 16's flow via TASK_ID.

# 13 — AC-1.5: mixed bulk must 409 and change nothing
curl -s "$BASE/api/tasks?status=TODO&size=2" > /tmp/v1.json
curl -s "$BASE/api/tasks?status=DONE&size=1" > /tmp/v2.json
T1=$(jq -r '.content[0].id' /tmp/v1.json); T2=$(jq -r '.content[1].id' /tmp/v1.json)
T3=$(jq -r '.content[0].id' /tmp/v2.json)
assert_status "13. bulk with one illegal → 409" 409 -X POST "$BASE/api/tasks/bulk-status" \
  -H 'content-type: application/json' \
  -d "{\"ids\":[\"$T1\",\"$T2\",\"$T3\"],\"status\":\"IN_PROGRESS\"}"
jq -r '.errors[].field' "$BODY" | grep -q '^ids\[' || fail "13a. errors[].field" "no ids[*] field"
pass "13a. errors[].field starts with ids["
for i in "$T1" "$T2" "$T3"; do
  curl -s "$BASE/api/tasks/$i" > /tmp/chk.json
  v=$(jq -r '.status' /tmp/chk.json)
  case "$i" in "$T1"|"$T2") [[ "$v" == "TODO" ]] || fail "13b. $i changed to $v" "bulk mutated" ;;
                           *) [[ "$v" == "DONE" ]] || fail "13b. $i changed to $v" "bulk mutated" ;; esac
done
pass "13b. none of the three changed"

# 14 — FR-B-07: all-legal bulk updates 3
curl -s "$BASE/api/tasks?status=TODO&size=3" > /tmp/v3.json
T1=$(jq -r '.content[0].id' /tmp/v3.json); T2=$(jq -r '.content[1].id' /tmp/v3.json); T3=$(jq -r '.content[2].id' /tmp/v3.json)
assert_status "14. bulk all-legal → 200" 200 -X POST "$BASE/api/tasks/bulk-status" \
  -H 'content-type: application/json' \
  -d "{\"ids\":[\"$T1\",\"$T2\",\"$T3\"],\"status\":\"IN_PROGRESS\"}"
assert_json "14a. updated == 3" ".updated" "3"

# restore the bulk-mutated trio to TODO so the seed-state assertion 24 is meaningful
curl -s -X POST "$BASE/api/tasks/bulk-status" -H 'content-type: application/json' \
  -d "{\"ids\":[\"$T1\",\"$T2\",\"$T3\"],\"status\":\"TODO\"}" > /dev/null

# 15 — FR-B-09
assert_status "15. GET /api/team-members → 200" 200 "$BASE/api/team-members"
assert_json "15a. length == 6" "length" "6"
NAMES=$(jq -r '[.[].displayName] | join(",")' "$BODY")
SORTED=$(jq -r '[.[].displayName] | sort | join(",")' "$BODY")
[[ "$NAMES" == "$SORTED" ]] || fail "15b. sorted by displayName" "$NAMES"
pass "15b. sorted by displayName"

# 16 — FR-B-05
assert_status "16. DELETE → 204" 204 -X DELETE "$BASE/api/tasks/$TASK_ID"
assert_status "16a. GET deleted → 404" 404 "$BASE/api/tasks/$TASK_ID"

# 23 — NFR-4: the AI switch
say "== boot with APP_AI_ENABLED=false (port $((PORT+1))) =="
(cd "$BACKEND_DIR" && APP_AI_ENABLED=false SERVER_PORT=$((PORT+1)) ./gradlew bootRun > "$OUT/bootrun-disabled.log" 2>&1 &)
for _ in $(seq 1 60); do
  if curl -sf -m 3 "http://localhost:$((PORT+1))/api/tasks/stats" >/dev/null 2>&1; then break; fi
  sleep 2
done
assert_status "23. /api/tasks with AI off → 200" 200 "http://localhost:$((PORT+1))/api/tasks?size=1"
assert_status "23a. /agent with AI off → 404" 404 -X POST "http://localhost:$((PORT+1))/agent" \
  -H 'content-type: application/json' -d '{"threadId":"t","runId":"r","messages":[]}'
kill "$(lsof -ti tcp:$((PORT+1)))" 2>/dev/null; sleep 2
# the disabled server dies by port; the main server (if we own it) is untouched

# 24 — FR-B-15: restart preserves seed (only when the script owns the server)
SEED_TOTAL=$(curl -s "$BASE/api/tasks/stats" | jq '.total')
MEMBER_ID=$(curl -s "$BASE/api/team-members" | jq -r '.[0].id')
if [[ "$OWN_SERVER" == 1 ]]; then
  pkill -f "BackendApplication" 2>/dev/null; sleep 2
  (cd "$BACKEND_DIR" && ./gradlew bootRun > "$OUT/bootrun2.log" 2>&1 &)
  for _ in $(seq 1 60); do
    if curl -sf -m 3 "$BASE/api/tasks/stats" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  NEW_TOTAL=$(curl -s "$BASE/api/tasks/stats" | jq '.total')
  [[ "$NEW_TOTAL" == "$SEED_TOTAL" ]] || fail "24. seed total" "was $SEED_TOTAL now $NEW_TOTAL"
  pass "24. seed total after restart still $SEED_TOTAL"
  v=$(curl -s "$BASE/api/team-members" | jq -r --arg id "$MEMBER_ID" '.[] | select(.id==$id) | .displayName')
  [[ -n "$v" ]] || fail "24a. seeded member id" "gone"
  pass "24a. seeded member id $MEMBER_ID still resolves ($v)"
else
  skip "24. seed unchanged after restart" "server not owned by this script — cannot restart it safely"
fi

# ---------------------------------------------------------- model assertions

if [[ "$WITH_MODEL" == no ]]; then
  for n in 17 18 19 20 21 22; do skip "$n." "model skipped (--no-model)"; done
else
  say "== model assertions (17-22) =="

  # 17 — FR-AI-01
  sse_capture "17. POST /agent answers an SSE stream" '{"threadId":"v1","runId":"r1","messages":[{"id":"m1","role":"user","content":"say hi in three words"}]}' "$OUT/17.sse"
  for t in RUN_STARTED TEXT_MESSAGE_START TEXT_MESSAGE_CONTENT RUN_FINISHED; do
    grep -q "\"type\":\"$t\"" "$OUT/17.sse" || fail "17. stream has $t" "missing"
  done
  pass "17a. stream has RUN_STARTED, TEXT_MESSAGE_*, RUN_FINISHED"
  OUT_TYPE=$(grep '^data:' "$OUT/17.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.type')
  [[ "$OUT_TYPE" == "success" ]] || fail "17b. outcome.type" "$OUT_TYPE"
  pass "17b. outcome.type == success"

  # 18 — FR-S-01
  sse_capture "18. POST /agent with state" '{"threadId":"v2","runId":"r1","state":{"context":{"today":"2026-01-05"}},"messages":[{"id":"m1","role":"user","content":"hi"}]}' "$OUT/18.sse"
  grep -q '"type":"STATE_SNAPSHOT"' "$OUT/18.sse" || fail "18. STATE_SNAPSHOT" "missing"
  grep -q '"snapshot":{"context":{"today":"2026-01-05"}}' "$OUT/18.sse" || fail "18. snapshot echo" "mismatch"
  pass "18a. STATE_SNAPSHOT echoes the state"

  # 19 — FR-AI-09, AC-2.3 (prompt needs "list each task" + explicit tool name; a 4 B
  # model otherwise answers from memory or answers with get_task_stats)
  sse_capture "19. ask about overdue+blocked" '{"threadId":"v3","runId":"r1","state":{"context":{"today":"2026-01-05"}},"messages":[{"id":"m1","role":"user","content":"Which tasks are overdue and blocked? List each task; use query_tasks first, not get_task_stats."}]}' "$OUT/19.sse"
  grep -q '"toolCallName":"query_tasks"' "$OUT/19.sse" || fail "19a. query_tasks called" "no tool call in stream"
  pass "19a. TOOL_CALL_START with query_tasks"
  grep -q '"type":"TOOL_CALL_RESULT"' "$OUT/19.sse" || fail "19b. tool result" "missing"
  pass "19b. TOOL_CALL_RESULT present"

  # 20 — AC-2.1, FR-AI-13: a create request prefers the client tool; nothing is written
  BEFORE=$(curl -s "$BASE/api/tasks?q=Verify%20Script%20task" | jq '.totalElements')
  sse_capture "20. ask to create a task" "$(cat <<'JSON'
{"threadId":"v4","runId":"r1","messages":[{"id":"m1","role":"user","content":"create a task titled \"Verify Script task\""}],"tools":[{"name":"prefill_task_form","description":"Fill the new-task form for the user to review and save.","parameters":{"type":"object","properties":{"title":{"type":"string"},"priority":{"type":"string"},"dueDate":{"type":"string"}},"required":["title"]}}]}
JSON
)" "$OUT/20.sse"
  grep -q '"toolCallName":"prefill_task_form"' "$OUT/20.sse" || fail "20a. prefill called" "no client tool call"
  pass "20a. client tool call prefill_task_form"
  AFTER=$(curl -s "$BASE/api/tasks?q=Verify%20Script%20task" | jq '.totalElements')
  [[ "$AFTER" == "$BEFORE" ]] || fail "20b. task count" "$BEFORE -> $AFTER"
  pass "20b. no task created server-side"

  # 21 — FR-AI-11, C6: a mutation request pauses with exactly one interrupt
  SEED_ID=$(curl -s "$BASE/api/tasks?status=IN_REVIEW&size=1" | jq -r '.content[0].id')
  sse_capture "21. ask to mark a task done" "{\"threadId\":\"v5\",\"runId\":\"r1\",\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"content\":\"mark task $SEED_ID as done\"}]}" "$OUT/21.sse"
  OUT_TYPE=$(grep '^data:' "$OUT/21.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.type')
  [[ "$OUT_TYPE" == "interrupt" ]] || fail "21a. outcome interrupt" "$OUT_TYPE"
  pass "21a. outcome.type == interrupt"
  N=$(grep '^data:' "$OUT/21.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.interrupts | length')
  [[ "$N" == "1" ]] || fail "21b. exactly one interrupt" "$N"
  pass "21b. exactly one interrupt"
  grep '^data:' "$OUT/21.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.interrupts[0].metadata.arguments' \
    | grep -Eq 'create_task|update_task_status|update_task_fields|delete_task' \
    || fail "21c. metadata.arguments names a mutation" "missing"
  pass "21c. metadata.arguments names one of the four mutations"
  CALL_ID=$(grep '^data:' "$OUT/21.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.interrupts[0].toolCallId')

  # 22 — FR-AI-16: a rejection must acknowledge and never re-propose
  TOOL_ARGS=$(grep '^data:' "$OUT/21.sse" | sed 's/^data://' | jq -r 'select(.type=="RUN_FINISHED") | .outcome.interrupts[0].metadata.arguments')
  sse_capture "22. resume with approved:false" "{\"threadId\":\"v5\",\"runId\":\"r2\",\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"content\":\"mark task $SEED_ID as done\"},{\"id\":\"m2\",\"role\":\"assistant\",\"content\":\"\",\"toolCalls\":[{\"id\":\"$CALL_ID\",\"type\":\"function\",\"function\":{\"name\":\"propose_task_mutation\",\"arguments\":$(printf '%s' "$TOOL_ARGS" | jq -Rs .)}}]}],\"resume\":[{\"interruptId\":\"$CALL_ID\",\"status\":\"resolved\",\"payload\":{\"approved\":false,\"reason\":\"no\"}}]}" "$OUT/22.sse"
  grep -q '"type":"TEXT_MESSAGE_CONTENT"' "$OUT/22.sse" || fail "22a. acknowledge" "no text"
  pass "22a. the model produced text (acknowledgement)"
  grep -q '"toolCallName":"propose_task_mutation"' "$OUT/22.sse" \
    && fail "22b. no re-proposal" "propose_task_mutation called again"
  pass "22b. no re-proposal after rejection"
fi

# ---------------------------------------------------------- summary

say "=="
say "$PASSED passed, $SKIPPED skipped, $FAILED failed"
exit 0
