#!/usr/bin/env bash
# ==============================================================================
# pre-execution-hook.sh — DAG Gate Pre-Execution Hook
# ==============================================================================
# Purpose: Validates that a task exists in Task.DAG.json with status "pending"
#          before allowing its execution. Enforces the P0 rule that all work
#          items must first be planned by @Meta-Planner.
#
# Usage:   pre-execution-hook.sh <task_id>
#
# Exit:    0 — task found with status "pending" (proceed)
#          1 — task not found or status not "pending" (block)
# ==============================================================================

set -euo pipefail

TASK_ID="${1:-}"

if [ -z "$TASK_ID" ]; then
  echo "❌ [Orchestrator Gate] Usage: pre-execution-hook.sh <task_id>"
  exit 1
fi

# Resolve project root: .opencode/scripts/pre-execution-hook.sh → project_root/
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAG_FILE="${PROJECT_ROOT}/Task.DAG.json"

# ── Resolve Enforcement Mode ─────────────────────────────────────────
# Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
ENF_MODE="advisory"
if [ -f "${PROJECT_ROOT}/.opencode/project.config.json" ] && command -v node &>/dev/null; then
  ENF_MODE=$(node -e "
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
  # Fallback: use node for JSON parsing if neither jq nor python3 is available
  if command -v node &> /dev/null; then
    NODE_CHECK=$(node -e "
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
    echo "⚠️  [Orchestrator Gate] 缺少 jq 和 node，无法验证 DAG。请安装 jq 或 node。"
    if [ "$ENF_MODE" != "advisory" ]; then
      exit 1
    fi
  fi
fi

echo "✅ [${ENF_MODE}] 工作项 '${TASK_ID}' 验证通过（状态: pending）。"

# ─── Stage 2: Reconciliation Check ─────────────────────────────
# After DAG validation passes, run cross-reference consistency check
# among Task.DAG.json, gate-state.json, and machine.json.
# Warnings are logged but do not block dispatch (--strict not used here).
RECONCILE_SCRIPT="${SCRIPT_DIR}/reconciliation-check.sh"
if [ -x "$RECONCILE_SCRIPT" ]; then
  echo ""
  echo "── Stage 2: State Reconciliation ─────────────────────────────"
  # Run reconciliation in quiet mode for dispatch — only report if
  # critical inconsistencies found. Use --quiet for dispatch context.
  if "$RECONCILE_SCRIPT" --quiet 2>/dev/null; then
    echo "  ✅ State reconciliation passed."
  else
    RECONCILE_EXIT=$?
    if [ "$RECONCILE_EXIT" -eq 1 ]; then
      echo "  ⚠️  State reconciliation found inconsistencies (non-blocking for dispatch)."
      echo "  ⚠️  Run '.opencode/scripts/reconciliation-check.sh' for details."
    else
      echo "  ⚠️  State reconciliation skipped (precondition error — may be fresh project)."
    fi
  fi
else
  echo "  ℹ️  State reconciliation script not found (optional)."
fi

exit 0
