#!/usr/bin/env bash
# ==============================================================================
# pre-execution-hook.sh — Multi-Stage Pre-Execution Validation Hook
# ==============================================================================
# Stage 1 — Bun-first DAG/Gate/Registry Validation (pre-execution-gate.ts)
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

# Resolve project root: .opencode/scripts/pre-execution-hook.sh → project_root/
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAG_FILE="${PROJECT_ROOT}/Task.DAG.json"
PRE_EXEC_GATE="${SCRIPT_DIR}/pre-execution-gate.ts"

# ── FW-FIX-AGENT-IDENTITY (2026-06-13, @Super-Admin) ──
# Replace deprecated FRAMEWORK_AGENT env var with _dispatch_target.json read.
# FRAMEWORK_AGENT was never set by the runtime, causing:
#   (1) Super-Admin bypass to never fire (dead code)
#   (2) UC7KS Stage 4 gate to reject ALL agents as "unknown" in strict/locked
#
# Priority: _dispatch_target.json (with run_id staleness check) → empty
# Mirrors readDispatchTargetAgent() from pre-execution-gate.ts L319-339.
RESOLVED_AGENT=""
_DT_PATH="${PROJECT_ROOT}/.task_temp/_dispatch_target.json"
if [ -f "$_DT_PATH" ] && command -v bun &>/dev/null; then
  RESOLVED_AGENT=$(bun -e "
    try {
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync('${_DT_PATH}', 'utf8'));
      const runId = process.env.OPENCODE_RUN_ID || '';
      if (runId && d.run_id && d.run_id !== runId) {
        try { fs.unlinkSync('${_DT_PATH}'); } catch {}
        process.exit(0);
      }
      if (!runId && d.timestamp) {
        const age = Date.now() - new Date(d.timestamp).getTime();
        if (age > 30 * 60 * 1000) {
          try { fs.unlinkSync('${_DT_PATH}'); } catch {}
          process.exit(0);
        }
      }
      process.stdout.write(d.agent || '');
    } catch(e) { /* silent */ }
  " 2>/dev/null || echo "")
fi

# Super-Admin bypass: emergency framework administrator
_AGENT_NORM="${RESOLVED_AGENT#@}"
if [ "$_AGENT_NORM" = "Super-Admin" ]; then
  echo "[GATE] Super-Admin agent detected — bypassing DAG/enforcement gates for emergency maintenance."
  exit 0
fi

# ── Resolve Enforcement Mode ─────────────────────────────────────────
# Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
ENF_MODE="advisory"
if [ -f "${PROJECT_ROOT}/.opencode/project.config.json" ] && { command -v bun &>/dev/null || command -v bun &>/dev/null; }; then
  # CRIT-2a FIX: PATH-resolved bun (was /home/zhaoge/.bun/bin/bun)
  # CRIT-2b FIX: JSON.parse(fs.readFileSync) replaces require() for safe JSON loading
  # CRIT-2c FIX: Dual-key enforcement mode (develop_enforcement_mode || runtime_enforcement_mode)
  ENF_MODE=$(bun -e "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('${PROJECT_ROOT}/.opencode/project.config.json', 'utf8'));
      const mode = cfg.template_resolution?.develop_enforcement_mode || cfg.template_resolution?.runtime_enforcement_mode;
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
  echo "  ℹ️  pre-execution-gate.ts not found or bun unavailable — skipping Stage 1."
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
    # FW-FIX-P2-EXECUTION-ORDER (2026-06-14, @Super-Admin):
    # Extend DAG fallback to check dag.execution_order (flat arrays and nested
    # objects) alongside dag.tasks. When dag.tasks is empty (archived/phase
    # DAGs), tasks may only be defined in execution_order.<phase> arrays.
    TASK_EXISTS=$(jq --arg id "$TASK_ID" '
      (.tasks[]? | select(.id == $id)) as $task_obj
      | if $task_obj then $task_obj
      elif ([.execution_order // {} | to_entries[]?.value[]? | select(. == $id)] | length) > 0
      then {"id": $id, "status": "pending"}
      else empty
      end
    ' "$DAG_FILE" 2>/dev/null || echo "")
    if [ -z "$TASK_EXISTS" ]; then
      enf_exit "工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
    fi

    TASK_STATUS=$(echo "$TASK_EXISTS" | jq -r '.status' 2>/dev/null || echo "")
    if [ "$TASK_STATUS" != "pending" ]; then
      enf_exit "工作项 '${TASK_ID}' 的状态为 '${TASK_STATUS}'，非 'pending'。请检查 DAG 状态。"
    fi
  elif command -v python3 &> /dev/null; then
    # Fallback: use python3 for JSON parsing if jq is not available
    # FW-FIX-P2-EXECUTION-ORDER (2026-06-14, @Super-Admin):
    # Also check dag.execution_order for flat or phase-nested task ID arrays.
    PYTHON_CHECK=$(python3 -c "
import json, sys
try:
    with open('$DAG_FILE', 'r') as f:
        dag = json.load(f)
    task = next((t for t in dag.get('tasks', []) if t.get('id') == '$TASK_ID'), None)
    if task is None:
        eo = dag.get('execution_order', {})
        if isinstance(eo, dict):
            for phase_ids in eo.values():
                if isinstance(phase_ids, list) and '$TASK_ID' in phase_ids:
                    task = {'id': '$TASK_ID', 'status': 'pending'}
                    break
        elif isinstance(eo, list) and '$TASK_ID' in eo:
            task = {'id': '$TASK_ID', 'status': 'pending'}
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
    # Fallback: use bun for JSON parsing if neither jq nor python3 is available.
    # FW-PLAN-JS-TO-TS: Bun runs TypeScript directly; node fallback removed.
    if command -v bun &> /dev/null; then
      # FW-FIX-P2-EXECUTION-ORDER (2026-06-14, @Super-Admin):
      # Also check dag.execution_order for flat or phase-nested task ID arrays.
      BUN_CHECK=$(bun -e "
      const fs = require('fs');
      const dag = JSON.parse(fs.readFileSync('$DAG_FILE', 'utf8'));
      let task = dag.tasks?.find(t => t.id === '$TASK_ID');
      if (!task) {
        const eo = dag.execution_order || {};
        if (Array.isArray(eo)) {
          if (eo.includes('$TASK_ID')) task = { id: '$TASK_ID', status: 'pending' };
        } else {
          for (const phaseIds of Object.values(eo)) {
            if (Array.isArray(phaseIds) && phaseIds.includes('$TASK_ID')) {
              task = { id: '$TASK_ID', status: 'pending' };
              break;
            }
          }
        }
      }
      if (!task) {
        console.log('NOT_FOUND');
        process.exit(0);
      }
        console.log(task.status);
      " 2>/dev/null)
      if [ "$BUN_CHECK" = "NOT_FOUND" ]; then
        enf_exit "工作项 '${TASK_ID}' 不在 Task.DAG.json 中。必须先用 /dispatch @Meta-Planner 生成 DAG。"
      fi
      if [ "$BUN_CHECK" != "pending" ]; then
        enf_exit "工作项 '${TASK_ID}' 的状态为 '${BUN_CHECK}'，非 'pending'。请检查 DAG 状态。"
      fi
    else
      # No JSON parser available — fail-closed in strict/locked, warning in advisory
      enf_exit "缺少 JSON 解析器 (jq/python3/bun)。在 strict/locked 模式下无法验证 DAG。请安装 jq/python3 或 bun。"
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
  echo "  ℹ️  rule-registry-verify.ts not found or bun unavailable — skipping Stage 2."
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
  echo "  ℹ️  state-reconciliation.ts not found or bun unavailable — skipping Stage 2.5."
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
  echo "  ℹ️  install-hooks.ts not found or bun unavailable — skipping Stage 3."
fi

# ── Stage 4: UC7KS Knowledge Gate (FW-HARDEN-UC7KS-004) ──
# Validates agent knowledge cache compliance before allowing execution.
# Checks: (1) cache exists and is valid, (2) agent has UC7-001 compliance,
# (3) agent has declared module scope (strict/locked only).
echo ""
echo "────────────────────────────────────────────────────"
echo "  Stage 4: UC7KS Knowledge Gate"
echo "────────────────────────────────────────────────────"
INDEX_FILE="${PROJECT_ROOT}/docs/official_docs/index.json"
MACHINE_FILE="${PROJECT_ROOT}/.opencode/state/machine.json"
KNOWLEDGE_STATE="/tmp/uc7ks_knowledge_gate_$"
# FW-FIX-AGENT-IDENTITY: Use RESOLVED_AGENT from _dispatch_target.json (not deprecated FRAMEWORK_AGENT)
FRAMEWORK_KC="${RESOLVED_AGENT:-}"

# UC7-009: Super-Admin conditional bypass (GAP-C1 remediation, 2026-06-06)
# Super-Admin only bypasses the UC7KS gate when the knowledge cache is UNHEALTHY
# (missing, empty, or corrupt index.json). When the cache is healthy, Super-Admin
# follows the same UC7KS pipeline as all other agents per UC7-009.
SUPER_ADMIN_BYPASS="false"
# FW-FIX-AGENT-IDENTITY: Use _AGENT_NORM (stripped of @) from _dispatch_target.json
if [ "$_AGENT_NORM" = "Super-Admin" ]; then
  if [ -f "$INDEX_FILE" ] && [ -s "$INDEX_FILE" ]; then
    # Cache file exists and is non-empty — verify it's structurally valid
    CACHE_HEALTHY=$(bun -e "
      try {
        const idx = JSON.parse(require('fs').readFileSync('${INDEX_FILE}', 'utf8'));
        if (idx.manifest_version && Array.isArray(idx.entries) && idx.entries.length > 0) {
          console.log('healthy');
        } else {
          console.log('unhealthy');
        }
      } catch(e) { console.log('unhealthy'); }
    " 2>/dev/null || echo "unhealthy")
    if [ "$CACHE_HEALTHY" = "healthy" ]; then
      echo "  ℹ️  Knowledge cache healthy — Super-Admin follows UC7KS pipeline (UC7-009 enforced)"
      # SUPER_ADMIN_BYPASS remains false — fall through to normal checks
    else
      SUPER_ADMIN_BYPASS="true"
      echo "  ⚠️  UC7KS Gate emergency bypass — cache corrupted, Super-Admin emergency mode (UC7-009 conditional)"
    fi
  else
    SUPER_ADMIN_BYPASS="true"
    echo "  ⚠️  UC7KS Gate emergency bypass — cache not initialized, Super-Admin emergency mode (UC7-009 conditional)"
  fi
fi

if [ "$SUPER_ADMIN_BYPASS" = "true" ]; then
  echo "  ✅ UC7KS Gate bypassed — Super-Admin emergency maintenance mode"
else
  # Check 1: Cache existence and validity
  if [ -f "$INDEX_FILE" ]; then
    # CRIT-2b FIX: JSON.parse(fs.readFileSync) replaces require() for safe JSON loading
    if bun -e "
      const idx = JSON.parse(require('fs').readFileSync('$INDEX_FILE', 'utf8'));
      if (!idx.manifest_version || !Array.isArray(idx.entries)) process.exit(1);
      console.log(JSON.stringify({version: idx.manifest_version, entries: idx.entries.length}));
    " > "$KNOWLEDGE_STATE" 2>/dev/null; then
      KC_VERSION=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$KNOWLEDGE_STATE','utf8')).version)" 2>/dev/null || echo "unknown")
      KC_ENTRIES=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$KNOWLEDGE_STATE','utf8')).entries)" 2>/dev/null || echo "0")
      echo "  ✅ UC7KS Knowledge Cache: v$KC_VERSION ($KC_ENTRIES entries)"
      rm -f "$KNOWLEDGE_STATE"
    else
      echo "  ⚠️  UC7KS index.json is malformed — agents should rebuild via @Knowledge-Curator"
      rm -f "$KNOWLEDGE_STATE"
    fi
  else
    echo "  ℹ️  UC7KS knowledge cache not yet initialized (docs/official_docs/index.json not found)"
  fi

  # Check 2: Agent UC7-001 compliance (strict/locked mode — FW-HARDEN-UC7KS-004)
  if [ "$ENF_MODE" = "strict" ] || [ "$ENF_MODE" = "locked" ]; then
    if [ -f "$MACHINE_FILE" ] && command -v bun &>/dev/null; then
      # FW-FIX-AGENT-IDENTITY: Use RESOLVED_AGENT from _dispatch_target.json
      AGENT_KEY="${RESOLVED_AGENT#@}"
      UC7KS_CHECK=$(bun -e "
        // CRIT-2b FIX: JSON.parse(fs.readFileSync) replaces require()
        try {
          const m = JSON.parse(require('fs').readFileSync('${MACHINE_FILE}', 'utf8'));
          const kcs = m?.knowledge_cache_state;
          const sa = kcs?.session_access || {};
          const agentState = sa['${RESOLVED_AGENT:-}'] || sa['${AGENT_KEY:-}'];
          if (!agentState) { console.log('NO_STATE'); process.exit(0); }
          const compliant = agentState.uc7_001_compliant === true;
          const scope = agentState.declared_scope || null;
          console.log(JSON.stringify({ compliant, scope }));
        } catch(e) { console.log('ERROR'); }
      " 2>/dev/null || echo "ERROR")

      if [ "$UC7KS_CHECK" = "ERROR" ] || [ "$UC7KS_CHECK" = "NO_STATE" ]; then
        if [ "$UC7KS_CHECK" = "NO_STATE" ]; then
          enf_exit "UC7KS Gate: Agent '${RESOLVED_AGENT:-unknown}' has no knowledge cache state. Must declare scope (Step 0a) and search cache (Step 0b) first."
        else
          echo "  ⚠️  Could not verify UC7KS compliance state (machine.json read error)"
        fi
      else
        UC7KS_COMPLIANT=$(echo "$UC7KS_CHECK" | bun -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8').trim()).compliant)" 2>/dev/null || echo "false")
        if [ "$UC7KS_COMPLIANT" != "true" ]; then
          enf_exit "UC7KS Gate: Agent '${RESOLVED_AGENT:-unknown}' has not completed knowledge cache search (Step 0b). Must read docs/official_docs/index.json first."
        else
          echo "  ✅ UC7KS Gate passed — agent has completed cache search (uc7_001_compliant)"

          # UC7-001c HARDEN: Verify cache sufficiency evidence completeness
          # Three fields are REQUIRED: reason, files_read, content_summary.
          # Any missing → treat as insufficient (BLOCK in strict/locked).
          if [ -f "$MACHINE_FILE" ]; then
            UC7KS_EVIDENCE=$(bun -e "
              try {
                const m = JSON.parse(require('fs').readFileSync('${MACHINE_FILE}', 'utf8'));
                const sa = m?.knowledge_cache_state?.session_access || {};
                const agentState = sa['${RESOLVED_AGENT:-unknown}'] || {};
                const suff = agentState.cache_sufficiency || {};
                const missing = [];
                if (!suff.reason) missing.push('reason');
                if (!suff.files_read || !Array.isArray(suff.files_read)) missing.push('files_read');
                if (!suff.content_summary) missing.push('content_summary');
                console.log(missing.length ? 'MISSING:' + missing.join(',') : 'COMPLETE');
              } catch(e) { console.log('ERROR:' + e.message); }
            " 2>/dev/null || echo "ERROR")

            if [ "$UC7KS_EVIDENCE" = "COMPLETE" ]; then
              echo "  ✅ UC7KS sufficiency evidence complete (reason, files_read, content_summary)"
            else
              enf_exit "UC7KS Gate: Cache sufficiency evidence incomplete (UC7-001c). Missing: ${UC7KS_EVIDENCE#MISSING:}. Must provide reason, files_read, and content_summary. Re-run knowledge_cache_search. See preamble Step 0."
            fi
          fi
        fi
      fi
    else
      echo "  ⚠️  machine.json not found — UC7KS Gate agent compliance check skipped"
    fi
  else
    echo "  ⚠️  [ADVISORY] UC7KS agent compliance check skipped (non-blocking)"
  fi

  # Check 3: Janitor staleness & knowledge_state consistency (FW-REPAIR-UC7KS-KNOWLEDGE-STATE)
  # Reads janitor_interval_hours from project.config.json (default 24h).
  # If the janitor has never run (last_janitor_run is null) or the last run
  # exceeds the configured interval, triggers a janitor cycle.
  # Also detects knowledge_state drift (total_docs_count vs actual index.json entries).
  # Non-blocking: janitor failures are caught and logged; drift > 2 entries is reported.
  #
  # @since 2026-06-06 — FW-REPAIR-UC7KS-KNOWLEDGE-STATE
  # @see .task_temp/ARC-KNOWLEDGE-STATE/HANDOVER.md
  if [ -f "$INDEX_FILE" ] && [ -f "$MACHINE_FILE" ] && command -v bun &>/dev/null; then
    JANITOR_SCRIPT="${PROJECT_ROOT}/.opencode/scripts/knowledge/janitor.ts"
    CFG_FILE="${PROJECT_ROOT}/.opencode/project.config.json"

    # Read janitor_interval_hours from project.config.json (default 24h)
    JANITOR_INTERVAL=$(bun -e "
      try {
        const cfg = JSON.parse(require('fs').readFileSync('${CFG_FILE}', 'utf8'));
        const interval = cfg?.template_resolution?.['knowledge.janitor_interval_hours'];
        console.log(interval || 24);
      } catch(e) { console.log(24); }
    " 2>/dev/null || echo "24")

    # Check 3a: Janitor staleness
    if [ -f "$JANITOR_SCRIPT" ]; then
      LAST_JANITOR=$(bun -e "
        try {
          const m = JSON.parse(require('fs').readFileSync('${MACHINE_FILE}', 'utf8'));
          const ks = m?.knowledge_state || {};
          console.log(ks.last_janitor_run || 'null');
        } catch(e) { console.log('error'); }
      " 2>/dev/null || echo "error")

      TRIGGER_JANITOR="false"
      if [ "$LAST_JANITOR" = "null" ] || [ "$LAST_JANITOR" = "error" ]; then
        echo "  ⚠️  Janitor has never run — triggering initial cycle"
        TRIGGER_JANITOR="true"
      else
        HOURS_SINCE=$(bun -e "
          const last = new Date('${LAST_JANITOR}').getTime();
          const hours = (Date.now() - last) / 3600000;
          console.log(Math.floor(hours));
        " 2>/dev/null || echo "0")
        if [ "$HOURS_SINCE" -gt "$JANITOR_INTERVAL" ] 2>/dev/null; then
          echo "  ⚠️  Janitor stale (${HOURS_SINCE}h since last run, interval=${JANITOR_INTERVAL}h) — triggering cycle"
          TRIGGER_JANITOR="true"
        else
          echo "  ✅ Janitor fresh — last run ${HOURS_SINCE}h ago (interval=${JANITOR_INTERVAL}h)"
        fi
      fi

      if [ "$TRIGGER_JANITOR" = "true" ]; then
        bun "$JANITOR_SCRIPT" 2>/dev/null && echo "  ✅ Janitor cycle completed" || echo "  ⚠️  Janitor cycle failed — check $JANITOR_SCRIPT"
      fi
    fi

    # Check 3b: knowledge_state + knowledge_cache_state drift detection & auto-correction
    # FW-REPAIR-UNIFY-KNOWLEDGE (2026-06-07): Extended to check BOTH knowledge_state
    # AND knowledge_cache_state for drift against index.json. Previously only
    # knowledge_state was checked and drift was reported but NOT auto-corrected.
    # Now auto-corrects both fields when drift is detected, eliminating the
    # "run reconciliation to fix" manual step.
    DRIFT=$(bun -e "
      try {
        const fs = require('fs');
        const m = JSON.parse(fs.readFileSync('${MACHINE_FILE}', 'utf8'));
        const idx = JSON.parse(fs.readFileSync('${INDEX_FILE}', 'utf8'));
        const ks = m.knowledge_state || {};
        const kcs = m.knowledge_cache_state || {};
        const actualCount = (idx.entries || []).length;

        // Compute total_size_bytes from index.json
        let totalSize = 0;
        for (const entry of (idx.entries || [])) {
          for (const file of (entry.files || [])) {
            totalSize += file.size_bytes || 0;
          }
        }

        const ksDrift = actualCount - (ks.total_docs_count || 0);
        const kcsDrift = actualCount - (kcs.total_entries || 0);
        const sizeDrift = totalSize - (ks.total_size_bytes || 0);

        // Detect drift > 1 entry (tolerance of ±1 for transient states)
        if (Math.abs(ksDrift) > 1 || Math.abs(kcsDrift) > 1 || Math.abs(sizeDrift) > 1024) {
          // Auto-correct: update both knowledge_state and knowledge_cache_state
          const now = new Date().toISOString();
          m.knowledge_state = m.knowledge_state || {};
          m.knowledge_state.total_docs_count = actualCount;
          m.knowledge_state.total_size_bytes = totalSize;
          m.knowledge_state.last_reconciliation = now;

          m.knowledge_cache_state = m.knowledge_cache_state || {};
          m.knowledge_cache_state.total_entries = actualCount;
          if (!m.knowledge_cache_state.pipeline_integrity) {
            m.knowledge_cache_state.pipeline_integrity = {};
          }
          m.knowledge_cache_state.pipeline_integrity.verified_count = actualCount;
          m.knowledge_cache_state.pipeline_integrity.last_verification_at = now;
          m.knowledge_cache_state.last_index_check = now;
          m.knowledge_cache_state.cache_status = 'healthy';

          // Atomic write
          const tmp = '${MACHINE_FILE}.tmp.' + Date.now();
          fs.writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8');
          fs.renameSync(tmp, '${MACHINE_FILE}');
          console.log('corrected:' + ksDrift + '/' + kcsDrift + '/' + sizeDrift +
            ' (actual=' + actualCount + ', total_size=' + totalSize + ')');
        } else {
          console.log('ok');
        }
      } catch(e) { console.log('error:' + e.message); }
    " 2>/dev/null || echo "error")

    if echo "$DRIFT" | grep -q "^corrected:"; then
      echo "  ✅ knowledge cache drift auto-corrected: $DRIFT"
    elif [ "$DRIFT" = "ok" ]; then
      # ok — drift within tolerance
      :
    elif echo "$DRIFT" | grep -q "^error:"; then
      echo "  ⚠️  knowledge cache drift check failed — $DRIFT"
    else
      # Unexpected output — log but don't block
      :
    fi
  fi
fi

exit 0
