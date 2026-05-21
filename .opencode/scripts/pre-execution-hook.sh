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

if [ ! -f "$DAG_FILE" ]; then
  echo "❌ [Orchestrator Gate] Task.DAG.json 在项目根目录不存在。必须先用 /dispatch @Meta-Planner 生成 DAG。"
  exit 1
fi

# Check if task exists with status "pending"
# Use jq for robust JSON querying
if command -v jq &> /dev/null; then
  TASK_EXISTS=$(jq --arg id "$TASK_ID" '.tasks[] | select(.id == $id)' "$DAG_FILE" 2>/dev/null || echo "")
  if [ -z "$TASK_EXISTS" ]; then
    echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
    exit 1
  fi

  TASK_STATUS=$(echo "$TASK_EXISTS" | jq -r '.status' 2>/dev/null || echo "")
  if [ "$TASK_STATUS" != "pending" ]; then
    echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 的状态为 '${TASK_STATUS}'，非 'pending'。请检查 DAG 状态。"
    exit 1
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
    echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
    exit 1
  fi
  if [ "$PYTHON_CHECK" != "pending" ]; then
    echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 的状态为 '${PYTHON_CHECK}'，非 'pending'。请检查 DAG 状态。"
    exit 1
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
      echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
      exit 1
    fi
    if [ "$NODE_CHECK" != "pending" ]; then
      echo "❌ [Orchestrator Gate] 工作项 '${TASK_ID}' 的状态为 '${NODE_CHECK}'，非 'pending'。请检查 DAG 状态。"
      exit 1
    fi
  else
    echo "⚠️  [Orchestrator Gate] 缺少 jq 和 node，无法验证 DAG。请安装 jq 或 node。"
    exit 1
  fi
fi

echo "✅ [Orchestrator Gate] 工作项 '${TASK_ID}' 验证通过（状态: pending）。"
exit 0
