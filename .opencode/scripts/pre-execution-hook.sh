#!/usr/bin/env bash
# ==============================================================================
# pre-execution-hook.sh — Multi-Stage Pre-Execution Validation Hook
# ==============================================================================
# Stage 1 — Node-first DAG/Gate/Registry Validation (pre-execution-gate.ts)
# Stage 2 — Rule Registry Integrity Verification (rule-registry-verify.ts)
# Stage 3 — Git Hooks Installation & Verification (install-hooks.ts)
#
# Usage:   pre-execution-hook.sh <task_id>
#
# Exit:    0 — all checks passed (proceed)
#          1 — validation failure (block)
# ==============================================================================

set -euo pipefail

TASK_ID="${1:-}"

if [ -z "$TASK_ID" ]; then
  echo "❌ [Orchestrator Gate] Usage: pre-execution-hook.sh <task_id>"
  exit 1
fi

# Super-Admin bypass: emergency framework administrator
if [ "${FRAMEWORK_AGENT:-}" = "Super-Admin" ] || [ "${FRAMEWORK_AGENT:-}" = "@Super-Admin" ]; then
  echo "[GATE] Super-Admin agent detected — bypassing DAG/enforcement gates for emergency maintenance."
  exit 0
fi

# Resolve project root: .opencode/scripts/pre-execution-hook.sh → project_root/
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAG_FILE="${PROJECT_ROOT}/Task.DAG.json"
PRE_EXEC_GATE="${SCRIPT_DIR}/pre-execution-gate.ts"

# ── Resolve Enforcement Mode ─────────────────────────────────────────
# Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
ENF_MODE="advisory"
if [ -f "${PROJECT_ROOT}/.opencode/project.config.json" ] && { command -v bun &>/dev/null || command -v bun &>/dev/null; }; then
  ENF_MODE=$(/home/zhaoge/.bun/bin/bun -e "
    try {
      const cfg = require('${PROJECT_ROOT}/.opencode/project.config.json');
      const mode = cfg.template_resolution?.enforcement_mode;
      console.log(mode && ['advisory','strict','locked'].includes(mode) ? mode : 'advisory');
    } catch(e) { console.log('advisory'); }
  " 2>/dev/null || echo "advisory")
fi

if [ -n "${ENFORCEMENT_MODE:-}" ]; then
  local_env="${ENFORCEMENT_MODE}"
  case "$local_env" in
    advisory|strict|locked)
      if [ "$ENF_MODE" != "locked" ]; then
        ENF_MODE="$local_env"
      fi
      ;;
  esac
fi

# Helper: emit warning or error based on enforcement mode
enf_exit() {
  local msg="$1"
  if [ "$ENF_MODE" = "advisory" ]; then
    echo "⚠️  [ADVISORY] ${msg} (non-blocking in advisory mode)"
    return 0
  else
    echo "❌ [${ENF_MODE}] ${msg}"
    exit 1
  fi
}

# ══════════════════════════════════════════════════════════════════════
# Stage 1: Node-First Pre-Execution Gate (pre-execution-gate.ts)
# ══════════════════════════════════════════════════════════════════════
# Validates DAG coverage, gate lifecycle, role violations, rule registry,
# and config validity — all via Node path APIs (no shell path manipulation).
echo ""
echo "── Stage 1: Pre-Execution Gate ────────────────────────────────────"

if [ -f "$PRE_EXEC_GATE" ] && command -v bun &>/dev/null; then
  if bun "$PRE_EXEC_GATE" "$TASK_ID" 2>&1; then
    echo "  ✅ Stage 1 pre-execution gate passed."
    echo ""
  else
    GATE_EXIT=$?
    if [ "$ENF_MODE" = "advisory" ]; then
      echo "  ⚠️  [ADVISORY] Stage 1 pre-execution gate had warnings (non-blocking)."
    else
      echo "  ❌ [${ENF_MODE}] Stage 1 pre-execution gate FAILED — dispatch blocked."
      exit $GATE_EXIT
    fi
  fi
else
  echo "  ℹ️  pre-execution-gate.ts not found or node unavailable — skipping Stage 1."
  echo "  ⚠️  Full DAG/gate/registry validation not performed."
fi

# ── Legacy DAG Fallback Check ────────────────────────────────────────
# If pre-execution-gate.ts ran, DAG coverage is already validated.
# This fallback only runs when pre-execution-gate.ts is not available.
if [ ! -f "$PRE_EXEC_GATE" ] || ! command -v bun &>/dev/null; then
  echo ""
  echo "── Stage 1b: Legacy DAG Fallback Check ────────────────────────────"

  if [ ! -f "$DAG_FILE" ]; then
    enf_exit "Task.DAG.json 在项目根目录不存在。必须先用 /dispatch @Meta-Planner 生成 DAG。"
  fi

  # Check if task exists with status "pending"
  # Use jq for robust JSON querying
  if command -v jq &> /dev/null; then
    TASK_EXISTS=$(jq --arg id "$TASK_ID" '.tasks[] | select(.id == $id)' "$DAG_FILE" 2>/dev/null || echo "")
    if [ -z "$TASK_EXISTS" ]; then
      enf_exit "工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
    fi

    TASK_STATUS=$(echo "$TASK_EXISTS" | jq -r '.status' 2>/dev/null || echo "")
    if [ "$TASK_STATUS" != "pending" ]; then
      enf_exit "工作项 '${TASK_ID}' 的状态为 '${TASK_STATUS}'，非 'pending'。请检查 DAG 状态。"
    fi
  elif command -v python3 &> /dev/null; then
    # Fallback: use python3 for JSON parsing if jq is not available
    PYTHON_CHECK=$(python3 -c "
import json, sys
try:
    with open('$DAG_FILE', 'r') as f:
        dag = json.load(f)
    task = next((t for t in dag.get('tasks', []) if t.get('id') == '$TASK_ID'), None)
    if task is None:
        print('NOT_FOUND')
    else:
        print(task.get('status', ''))
except Exception as e:
    print('ERROR')
    " 2>/dev/null)
    if [ "$PYTHON_CHECK" = "NOT_FOUND" ]; then
      enf_exit "工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
    fi
    if [ "$PYTHON_CHECK" != "pending" ]; then
      enf_exit "工作项 '${TASK_ID}' 的状态为 '${PYTHON_CHECK}'，非 'pending'。请检查 DAG 状态。"
    fi
  else
    # Fallback: use node for JSON parsing if neither jq nor python3 is available.
    # Cross-platform node discovery: Unix (node) → Windows (node.exe) → legacy (which/type)
    NODE_CMD=""
    if command -v bun &> /dev/null; then
      NODE_CMD="node"
    elif command -v bun.exe &> /dev/null; then
      NODE_CMD="node.exe"
    elif which node &> /dev/null 2>&1 || type node &> /dev/null 2>&1; then
      NODE_CMD="node"
    fi

    if [ -n "$NODE_CMD" ]; then
      NODE_CHECK=$("$NODE_CMD" -e "
      const fs = require('fs');
      const dag = JSON.parse(fs.readFileSync('$DAG_FILE', 'utf8'));
      const task = dag.tasks.find(t => t.id === '$TASK_ID');
      if (!task) {
        console.log('NOT_FOUND');
        process.exit(0);
      }
        console.log(task.status);
      " 2>/dev/null)
      if [ "$NODE_CHECK" = "NOT_FOUND" ]; then
        enf_exit "工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
      fi
      if [ "$NODE_CHECK" != "pending" ]; then
        enf_exit "工作项 '${TASK_ID}' 的状态为 '${NODE_CHECK}'，非 'pending'。请检查 DAG 状态。"
      fi
    else
      # No JSON parser available — fail-closed in strict/locked, warning in advisory
      enf_exit "缺少 JSON 解析器 (jq/python3/node/node.exe)。在 strict/locked 模式下无法验证 DAG。请安装 jq/python3 或 node。"
    fi
  fi

  echo "✅ [${ENF_MODE}] 工作项 '${TASK_ID}' 验证通过（状态: pending）。"
fi  # End of legacy DAG fallback block

# ─── Stage 2: Rule Registry Integrity Verification ─────────────
# Runs rule-registry-verify.ts to validate all registered rule/skill/
# requirement/agent file digests against rule_registry.json.
# Mismatches without semver bump (HIGH) block execution in strict/locked mode.
echo ""
echo "── Stage 2: Rule Registry Verification ─────────────────────────"

RULE_VERIFY_SCRIPT="${SCRIPT_DIR}/rule-registry-verify.ts"
if [ -f "$RULE_VERIFY_SCRIPT" ] && command -v bun &>/dev/null; then
  if bun "$RULE_VERIFY_SCRIPT" --strict 2>&1; then
    echo "  ✅ All rule registry digests verified."
  else
    VERIFY_EXIT=$?
    if [ "$ENF_MODE" = "advisory" ]; then
      echo "  ⚠️  [ADVISORY] Rule registry verification found issues (non-blocking)."
    else
      echo "  ❌ [${ENF_MODE}] Rule registry verification FAILED — dispatch blocked."
      exit $VERIFY_EXIT
    fi
  fi
else
  echo "  ℹ️  rule-registry-verify.ts not found or node unavailable — skipping Stage 2."
fi

# ─── Stage 2.5: State Reconciliation (DAG ↔ Gate ↔ Machine consistency) ──
# Runs state-reconciliation.ts in --quick mode (skips deep write-audit scan).
# In strict/locked mode, inconsistencies block execution.
echo ""
echo "── Stage 2.5: State Reconciliation ────────────────────────────"

STATE_RECONCILE_SCRIPT="${SCRIPT_DIR}/state-reconciliation.ts"
if [ -f "$STATE_RECONCILE_SCRIPT" ] && command -v bun &>/dev/null; then
  if bun "$STATE_RECONCILE_SCRIPT" --quick 2>&1; then
    echo "  ✅ State reconciliation passed."
  else
    RECONCILE_EXIT=$?
    if [ "$ENF_MODE" = "advisory" ]; then
      echo "  ⚠️  [ADVISORY] State reconciliation found inconsistencies (non-blocking)."
      echo "  🔧 Fix: bun .opencode/scripts/state-reconciliation.ts --fix"
    else
      echo "  ❌ [${ENF_MODE}] State reconciliation FAILED — dispatch blocked."
      echo "  🔧 Fix: bun .opencode/scripts/state-reconciliation.ts --fix"
      exit $RECONCILE_EXIT
    fi
  fi
else
  echo "  ℹ️  state-reconciliation.ts not found or node unavailable — skipping Stage 2.5."
fi

# ─── Stage 3: Git Hooks Installation & Verification ────────────
# Ensures git config core.hooksPath is set to .opencode/hooks and
# validates all required hook scripts exist and are executable.
echo ""
echo "── Stage 3: Git Hooks Verification ─────────────────────────────"

INSTALL_HOOKS_SCRIPT="${SCRIPT_DIR}/install-hooks.ts"
if [ -f "$INSTALL_HOOKS_SCRIPT" ] && command -v bun &>/dev/null; then
  if bun "$INSTALL_HOOKS_SCRIPT" --verify 2>&1; then
    echo "  ✅ Git hooks verified."
  else
    HOOKS_EXIT=$?
    if [ "$ENF_MODE" = "advisory" ]; then
      echo "  ⚠️  [ADVISORY] Git hooks verification failed (non-blocking)."
      echo "  ⚠️  Run 'bun .opencode/scripts/install-hooks.ts' to repair."
    else
      echo "  ❌ [${ENF_MODE}] Git hooks verification FAILED — dispatch blocked."
      echo "  ❌ Run 'bun .opencode/scripts/install-hooks.ts' to repair hooks."
      exit $HOOKS_EXIT
    fi
  fi
else
  echo "  ℹ️  install-hooks.ts not found or node unavailable — skipping Stage 3."
fi

# ── Stage 4: UC7KS Knowledge Gate ──
echo ""
echo "────────────────────────────────────────────────────"
echo "  Stage 4: UC7KS Knowledge Gate"
echo "────────────────────────────────────────────────────"
INDEX_FILE="${PROJECT_ROOT}/docs/official_docs/index.json"
KNOWLEDGE_STATE="/tmp/uc7ks_knowledge_gate_$"
FRAMEWORK_KC="${FRAMEWORK_AGENT:-}"

# Check if agent has docs/official_docs/index.json as a known knowledge source
if [ -f "$INDEX_FILE" ]; then
  if bun -e "
    const idx = require('$INDEX_FILE');
    if (!idx.manifest_version || !Array.isArray(idx.entries)) process.exit(1);
    console.log(JSON.stringify({version: idx.manifest_version, entries: idx.entries.length}));
  " > "$KNOWLEDGE_STATE" 2>/dev/null; then
    KC_VERSION=$(bun -e "console.log(require('$KNOWLEDGE_STATE').version)" 2>/dev/null || echo "unknown")
    KC_ENTRIES=$(bun -e "console.log(require('$KNOWLEDGE_STATE').entries)" 2>/dev/null || echo "0")
    echo "  ✅ UC7KS Knowledge Cache: v$KC_VERSION ($KC_ENTRIES entries)"
    rm -f "$KNOWLEDGE_STATE"
  else
    echo "  ⚠️  UC7KS index.json is malformed — agents should rebuild via @Knowledge-Curator"
    rm -f "$KNOWLEDGE_STATE"
  fi
else
  echo "  ℹ️  UC7KS knowledge cache not yet initialized (docs/official_docs/index.json not found)"
fi

exit 0
