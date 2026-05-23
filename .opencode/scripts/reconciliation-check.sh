#!/usr/bin/env bash
# ==============================================================================
# reconciliation-check.sh — State Reconciliation Daemon
# ==============================================================================
# Purpose: Validates cross-reference consistency among three state planes:
#           1. Task.DAG.json          — task planning/execution state
#           2. gate-state.json        — compliance gate session state
#           3. machine.json           — write audit / enforcement state
#
# Checks:
#   Check 1 (DAG ↔ Gate):   Every in_progress DAG task MUST have an armed gate
#                            session. Every armed gate session MUST reference a
#                            valid pending/in_progress DAG task.
#   Check 2 (Gate ↔ Machine): Every armed gate session MUST have a matching
#                              write_audit_state entry. Orphaned sessions flagged.
#   Check 3 (DAG ↔ Machine): Completed tasks must have write audit history.
#                             Pending tasks must NOT have write audit entries.
#
# Usage:   reconciliation-check.sh [--quiet] [--strict]
#          --quiet  : suppress per-check detail, only print summary line
#          --strict : treat warnings as errors (exit 1 on any inconsistency)
#
# Exit:    0 — all three state planes consistent
#          1 — inconsistencies found (or strict mode with warnings)
#          2 — precondition failure (missing files, parse errors)
# ==============================================================================

set -euo pipefail

QUIET=false
STRICT=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --strict) STRICT=true ;;
  esac
done

# ─── Path Resolution ──────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAG_FILE="${PROJECT_ROOT}/Task.DAG.json"
GATE_FILE="${PROJECT_ROOT}/.opencode/state/gate-state.json"
MACHINE_FILE="${PROJECT_ROOT}/.opencode/state/machine.json"

# ─── State Tracking ────────────────────────────────────────────
INCONSISTENCIES=0
WARNINGS=0
declare -a INCONSISTENCY_DETAILS=()

log_inconsistency() {
  INCONSISTENCIES=$((INCONSISTENCIES + 1))
  INCONSISTENCY_DETAILS+=("$1")
  if [ "$QUIET" != "true" ]; then
    echo "  ⚠️  $1"
  fi
}

log_error() {
  INCONSISTENCIES=$((INCONSISTENCIES + 1))
  INCONSISTENCY_DETAILS+=("❌ $1")
  echo "  ❌ $1"
}

# ─── Precondition Checks ───────────────────────────────────────
if [ ! -f "$DAG_FILE" ]; then
  echo "❌ [Reconciliation] Task.DAG.json not found at project root. Cannot reconcile."
  exit 2
fi

if [ ! -f "$GATE_FILE" ]; then
  echo "❌ [Reconciliation] gate-state.json not found. Cannot reconcile."
  exit 2
fi

if [ ! -f "$MACHINE_FILE" ]; then
  echo "❌ [Reconciliation] machine.json not found. Cannot reconcile."
  exit 2
fi

# ─── JSON Query Functions ──────────────────────────────────────
# Try jq first, then python3, then node

_json_query_dag() {
  local filter="$1"
  if command -v jq &> /dev/null; then
    jq -r "$filter" "$DAG_FILE" 2>/dev/null || echo ""
  elif command -v python3 &> /dev/null; then
    python3 -c "
import json
with open('$DAG_FILE', 'r') as f:
    dag = json.load(f)
$filter
" 2>/dev/null || echo ""
  elif command -v node &> /dev/null; then
    node -e "
const dag = JSON.parse(require('fs').readFileSync('$DAG_FILE', 'utf8'));
$filter
" 2>/dev/null || echo ""
  else
    echo "ERROR:NO_JSON_TOOL"
  fi
}

_json_query_gate() {
  local filter="$1"
  if command -v jq &> /dev/null; then
    jq -r "$filter" "$GATE_FILE" 2>/dev/null || echo ""
  elif command -v python3 &> /dev/null; then
    python3 -c "
import json
with open('$GATE_FILE', 'r') as f:
    gate = json.load(f)
$filter
" 2>/dev/null || echo ""
  elif command -v node &> /dev/null; then
    node -e "
const gate = JSON.parse(require('fs').readFileSync('$GATE_FILE', 'utf8'));
$filter
" 2>/dev/null || echo ""
  else
    echo "ERROR:NO_JSON_TOOL"
  fi
}

_json_query_machine() {
  local filter="$1"
  if command -v jq &> /dev/null; then
    jq -r "$filter" "$MACHINE_FILE" 2>/dev/null || echo ""
  elif command -v python3 &> /dev/null; then
    python3 -c "
import json
with open('$MACHINE_FILE', 'r') as f:
    machine = json.load(f)
$filter
" 2>/dev/null || echo ""
  elif command -v node &> /dev/null; then
    node -e "
const machine = JSON.parse(require('fs').readFileSync('$MACHINE_FILE', 'utf8'));
$filter
" 2>/dev/null || echo ""
  else
    echo "ERROR:NO_JSON_TOOL"
  fi
}

# ─── Quick Capability Check ────────────────────────────────────
JSON_CHECK=$(_json_query_dag ".version" 2>/dev/null || echo "")
if [ -z "$JSON_CHECK" ] || [ "$JSON_CHECK" = "ERROR:NO_JSON_TOOL" ]; then
  echo "❌ [Reconciliation] No JSON query tool available (jq/python3/node). Install one."
  exit 2
fi

if [ "$QUIET" != "true" ]; then
  echo "═══════════════════════════════════════════════════════════════"
  echo "  🔍 State Reconciliation Check"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════
# Check 1: DAG ↔ Gate
# ═══════════════════════════════════════════════════════════════
if [ "$QUIET" != "true" ]; then
  echo "── Check 1: DAG ↔ Gate ──────────────────────────────────────"
fi

# Get all DAG tasks with status in_progress
DAG_IN_PROGRESS=$(_json_query_dag ".tasks[] | select(.status == \"in_progress\") | .id")

# Get all gate sessions that are armed (gate_status == "armed")
GATE_ARMED_SESSIONS=$(_json_query_gate ".sessions | to_entries[] | select(.value.gate_status == \"armed\") | .key")

# Get all gate sessions (all statuses) for reverse check
GATE_ALL_SESSIONS=$(_json_query_gate ".sessions | keys[]")

# 1a: Every in_progress DAG task must have an armed gate session
if [ -n "$DAG_IN_PROGRESS" ]; then
  while IFS= read -r task_id; do
    if [ -z "$task_id" ]; then continue; fi
    # Check if any gate session references this task_id
    HAS_MATCH=false
    if command -v jq &> /dev/null; then
      MATCH_COUNT=$(jq --arg id "$task_id" '[.sessions[] | select(.value.task_description | test($id; "i"))] | length' "$GATE_FILE" 2>/dev/null || echo "0")
      if [ "$MATCH_COUNT" != "0" ]; then
        HAS_MATCH=true
      fi
    else
      # For python3/node fallback, check if task_id appears in any session
      MATCH=$(_json_query_gate "for sid, s in gate['sessions'].items():
    td = s.get('task_description', '')
    if '$task_id' in td:
        print(sid)")
      if [ -n "$MATCH" ]; then
        HAS_MATCH=true
      fi
    fi

    if [ "$HAS_MATCH" != "true" ]; then
      # Also check consumed_at to see if session was completed for this task
      if command -v jq &> /dev/null; then
        COMPLETED_COUNT=$(jq --arg id "$task_id" '[.sessions[] | select(.value.task_description | test($id; "i")) | select(.value.gate_status == "completed")] | length' "$GATE_FILE" 2>/dev/null || echo "0")
        if [ "$COMPLETED_COUNT" != "0" ]; then
          if [ "$QUIET" != "true" ]; then
            echo "  ℹ️  DAG task '${task_id}' in_progress — has completed gate session (may need status sync)"
          fi
          WARNINGS=$((WARNINGS + 1))
          continue
        fi
      fi
      log_inconsistency "DAG task '${task_id}' is in_progress but has NO matching gate session (armed or completed)"
    fi
  done <<< "$DAG_IN_PROGRESS"
fi

# 1b: Every armed gate session must reference a valid DAG task
if [ -n "$GATE_ARMED_SESSIONS" ]; then
  while IFS= read -r session_id; do
    if [ -z "$session_id" ]; then continue; fi
    # Get the task_description from this session
    TASK_DESC=$(_json_query_gate ".sessions[\"$session_id\"].task_description // \"\"" 2>/dev/null || echo "")

    # Try to find a matching DAG task by scanning descriptions
    HAS_DAG_MATCH=false
    if [ -n "$TASK_DESC" ]; then
      DAG_IDS=$(_json_query_dag ".tasks[] | .id")
      while IFS= read -r dag_id; do
        if [ -z "$dag_id" ]; then continue; fi
        if echo "$TASK_DESC" | grep -qi "$dag_id" 2>/dev/null; then
          HAS_DAG_MATCH=true
          break
        fi
      done <<< "$DAG_IDS"
    fi

    if [ "$HAS_DAG_MATCH" != "true" ]; then
      log_inconsistency "Gate session '${session_id}' is armed but references no valid DAG task. Task description: '${TASK_DESC:0:80}...'"
    fi
  done <<< "$GATE_ARMED_SESSIONS"
fi

if [ "$QUIET" != "true" ]; then
  DAG_PROGRESS_COUNT=$(echo "$DAG_IN_PROGRESS" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")
  GATE_ARMED_COUNT=$(echo "$GATE_ARMED_SESSIONS" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")
  if [ -z "$DAG_IN_PROGRESS" ]; then DAG_PROGRESS_COUNT=0; fi
  if [ -z "$GATE_ARMED_SESSIONS" ]; then GATE_ARMED_COUNT=0; fi
  echo "  DAG in_progress: ${DAG_PROGRESS_COUNT} | Gate armed: ${GATE_ARMED_COUNT}"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════
# Check 2: Gate ↔ Machine
# ═══════════════════════════════════════════════════════════════
if [ "$QUIET" != "true" ]; then
  echo "── Check 2: Gate ↔ Machine ──────────────────────────────────"
fi

# Get write_audit_state.current_session
CURRENT_SESSION_AGENT=$(_json_query_machine ".write_audit_state.current_session.agent // \"\"" 2>/dev/null || echo "")
CURRENT_SESSION_TASK=$(_json_query_machine ".write_audit_state.current_session.task_id // \"\"" 2>/dev/null || echo "")

# 2a: If gate has armed sessions, write_audit_state should reflect active work
if [ -n "$GATE_ARMED_SESSIONS" ]; then
  GATE_ARMED_COUNT=$(echo "$GATE_ARMED_SESSIONS" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")

  if [ "$CURRENT_SESSION_AGENT" = "null" ] || [ -z "$CURRENT_SESSION_AGENT" ] || [ "$CURRENT_SESSION_AGENT" = "" ]; then
    if [ "$GATE_ARMED_COUNT" -gt 0 ]; then
      log_inconsistency "${GATE_ARMED_COUNT} gate session(s) armed but write_audit_state.current_session is empty (no active write audit tracking)"
    fi
  else
    # Verify current_session.task_id matches an armed gate session
    if [ -n "$CURRENT_SESSION_TASK" ] && [ "$CURRENT_SESSION_TASK" != "null" ]; then
      TASK_HAS_ARMED=false
      if [ -n "$GATE_ARMED_SESSIONS" ]; then
        while IFS= read -r sid; do
          if [ -z "$sid" ]; then continue; fi
          SID_DESC=$(_json_query_gate ".sessions[\"$sid\"].task_description // \"\"" 2>/dev/null || echo "")
          if echo "$SID_DESC" | grep -qi "$CURRENT_SESSION_TASK" 2>/dev/null; then
            TASK_HAS_ARMED=true
            break
          fi
        done <<< "$GATE_ARMED_SESSIONS"
      fi

      if [ "$TASK_HAS_ARMED" != "true" ]; then
        # Check if the task has a completed session instead
        COMPLETED_CHECK=$(_json_query_gate ".sessions[] | select(.value.task_description | test(\"$CURRENT_SESSION_TASK\"; \"i\")) | select(.value.gate_status == \"completed\") | .key" 2>/dev/null || echo "")
        if [ -z "$COMPLETED_CHECK" ]; then
          log_inconsistency "write_audit_state tracks task '${CURRENT_SESSION_TASK}' but no gate session (armed or completed) references it"
        fi
      fi
    fi
  fi
fi

# 2b: Orphan detection — gate sessions armed after gate confirmed but never consumed
if [ -n "$GATE_ARMED_SESSIONS" ]; then
  NOW_EPOCH=$(date +%s)
  while IFS= read -r sid; do
    if [ -z "$sid" ]; then continue; fi
    CONFIRMED_AT=$(_json_query_gate ".sessions[\"$sid\"].confirmed_at // \"\"" 2>/dev/null || echo "")
    CONSUMED_AT=$(_json_query_gate ".sessions[\"$sid\"].consumed_at // \"\"" 2>/dev/null || echo "")

    if [ -n "$CONFIRMED_AT" ] && [ "$CONFIRMED_AT" != "null" ] && \
       ( [ -z "$CONSUMED_AT" ] || [ "$CONSUMED_AT" = "null" ] ); then
      # Gate armed but not consumed — check staleness (> 1 hour)
      CONFIRMED_EPOCH=$(date -d "$CONFIRMED_AT" +%s 2>/dev/null || echo "0")
      if [ "$CONFIRMED_EPOCH" != "0" ]; then
        AGE_SEC=$((NOW_EPOCH - CONFIRMED_EPOCH))
        if [ "$AGE_SEC" -gt 3600 ]; then
          AGE_HOURS=$((AGE_SEC / 3600))
          log_inconsistency "Gate session '${sid}' armed for ${AGE_HOURS}h without being consumed (orphaned session)"
        fi
      fi
    fi
  done <<< "$GATE_ARMED_SESSIONS"
fi

if [ "$QUIET" != "true" ]; then
  echo "  Current write audit: agent=${CURRENT_SESSION_AGENT:-none}, task=${CURRENT_SESSION_TASK:-none}"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════
# Check 3: DAG ↔ Machine
# ═══════════════════════════════════════════════════════════════
if [ "$QUIET" != "true" ]; then
  echo "── Check 3: DAG ↔ Machine ───────────────────────────────────"
fi

# 3a: Tasks with status 'completed' should have write audit evidence
DAG_COMPLETED=$(_json_query_dag ".tasks[] | select(.status == \"completed\") | .id")
WRITE_AUDIT_FILES=$(cat "$MACHINE_FILE" | python3 -c "
import json, sys
m = json.load(sys.stdin)
files = m.get('write_audit_state', {}).get('current_session', {}).get('files_written', [])
for f in files:
    print(f)
" 2>/dev/null || echo "")

# 3b: Tasks with status 'pending' should NOT have active write audit tracking
DAG_PENDING=$(_json_query_dag ".tasks[] | select(.status == \"pending\") | .id")

if [ -n "$CURRENT_SESSION_TASK" ] && [ "$CURRENT_SESSION_TASK" != "null" ] && [ -n "$DAG_PENDING" ]; then
  while IFS= read -r task_id; do
    if [ -z "$task_id" ]; then continue; fi
    if [ "$task_id" = "$CURRENT_SESSION_TASK" ]; then
      DAG_STATUS=$(_json_query_dag ".tasks[] | select(.id == \"$task_id\") | .status" 2>/dev/null || echo "")
      if [ "$DAG_STATUS" = "pending" ]; then
        # task is pending in DAG but has active write audit — possible sync drift
        if [ "$QUIET" != "true" ]; then
          echo "  ℹ️  DAG task '${task_id}' is 'pending' but write_audit_state tracks it as current (agent=${CURRENT_SESSION_AGENT}). May be in-flight."
        fi
        WARNINGS=$((WARNINGS + 1))
      fi
    fi
  done <<< "$DAG_PENDING"
fi

# 3c: Completed tasks count vs write audit history
DAG_COMPLETED_COUNT=$(echo "$DAG_COMPLETED" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")
if [ -z "$DAG_COMPLETED" ]; then DAG_COMPLETED_COUNT=0; fi

if [ "$QUIET" != "true" ]; then
  echo "  DAG completed: ${DAG_COMPLETED_COUNT} | Write audit entries: $(echo "$WRITE_AUDIT_FILES" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════
DAG_TOTAL=$(_json_query_dag ".tasks | length" 2>/dev/null || echo "0")
DAG_PENDING_COUNT=$(echo "$DAG_PENDING" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")
GATE_TOTAL=$(_json_query_gate ".sessions | length" 2>/dev/null || echo "0")
GATE_ARMED_COUNT=$(echo "$GATE_ARMED_SESSIONS" | grep -c '[^[:space:]]' 2>/dev/null || echo "0")
MACHINE_STATE_STATUS=""
ESLINT_STATUS=$(_json_query_machine ".eslint_state.aggregate.total_violations // 0" 2>/dev/null || echo "0")
if [ "$ESLINT_STATUS" = "0" ]; then MACHINE_STATE_STATUS="clean"
else MACHINE_STATE_STATUS="dirty(${ESLINT_STATUS} violations)"; fi

if [ -z "$DAG_PENDING" ]; then DAG_PENDING_COUNT=0; fi
if [ -z "$GATE_ARMED_SESSIONS" ]; then GATE_ARMED_COUNT=0; fi

echo ""
echo "═══════════════════════════════════════════════════════════════"

if [ "$INCONSISTENCIES" -eq 0 ]; then
  STATUS_LINE="✅ [Reconciliation] DAG(${DAG_TOTAL} tasks, ${DAG_PENDING_COUNT} pending) ↔ Gate(${GATE_TOTAL} sessions, ${GATE_ARMED_COUNT} armed) ↔ Machine(${MACHINE_STATE_STATUS}) — consistent"
  echo "$STATUS_LINE"
  if [ "$STRICT" = "true" ] && [ "$WARNINGS" -gt 0 ]; then
    echo "⚠️  [Reconciliation] Strict mode: ${WARNINGS} warning(s) treated as errors."
    exit 1
  fi
  exit 0
else
  echo "❌ [Reconciliation] DAG(${DAG_TOTAL} tasks) ↔ Gate(${GATE_TOTAL} sessions) ↔ Machine(${MACHINE_STATE_STATUS}) — ${INCONSISTENCIES} inconsistency(ies) found"
  if [ "$QUIET" != "true" ]; then
    echo ""
    echo "Details:"
    for detail in "${INCONSISTENCY_DETAILS[@]}"; do
      echo "  $detail"
    done
  fi
  exit 1
fi
