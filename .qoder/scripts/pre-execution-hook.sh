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

# Resolve project root: .qoder/scripts/pre-execution-hook.sh → project_root/
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAG_FILE="${PROJECT_ROOT}/Task.DAG.json"

# ── Resolve Enforcement Mode ─────────────────────────────────────────
# Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
ENF_MODE="advisory"
if [ -f "${PROJECT_ROOT}/.qoder/project.config.json" ] && command -v node &>/dev/null; then
  ENF_MODE=$(node -e "
    try {
      const cfg = require('${PROJECT_ROOT}/.qoder/project.config.json');
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
  enf_exit "Task.DAG.json does not exist in the project root. You must first generate a DAG with /dispatch @Meta-Planner."
fi

# Check if task exists with status "pending"
# Use jq for robust JSON querying
if command -v jq &> /dev/null; then
  TASK_EXISTS=$(jq --arg id "$TASK_ID" '.tasks[] | select(.id == $id)' "$DAG_FILE" 2>/dev/null || echo "")
  if [ -z "$TASK_EXISTS" ]; then
    enf_exit "Work item '${TASK_ID}' not found in Task.DAG.json. You must first generate a DAG with /dispatch @Meta-Planner."
  fi

  TASK_STATUS=$(echo "$TASK_EXISTS" | jq -r '.status' 2>/dev/null || echo "")
  if [ "$TASK_STATUS" != "pending" ]; then
    enf_exit "Work item '${TASK_ID}' has status '${TASK_STATUS}', not 'pending'. Please check the DAG status."
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
    enf_exit "Work item '${TASK_ID}' not found in Task.DAG.json. You must first generate a DAG with /dispatch @Meta-Planner."
  fi
  if [ "$PYTHON_CHECK" != "pending" ]; then
    enf_exit "Work item '${TASK_ID}' has status '${PYTHON_CHECK}', not 'pending'. Please check the DAG status."
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
      enf_exit "Work item '${TASK_ID}' not found in Task.DAG.json. You must first generate a DAG with /dispatch @Meta-Planner."
    fi
    if [ "$NODE_CHECK" != "pending" ]; then
      enf_exit "Work item '${TASK_ID}' has status '${NODE_CHECK}', not 'pending'. Please check the DAG status."
    fi
  else
    echo "⚠️  [Orchestrator Gate] Missing jq and node, cannot verify DAG. Please install jq or node."
    if [ "$ENF_MODE" != "advisory" ]; then
      exit 1
    fi
  fi
fi

echo "✅ [${ENF_MODE}] Work item '${TASK_ID}' validated successfully (status: pending)."

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
      echo "  ⚠️  Run '.qoder/scripts/reconciliation-check.sh' for details."
    else
      echo "  ⚠️  State reconciliation skipped (precondition error — may be fresh project)."
    fi
  fi
else
  echo "  ℹ️  State reconciliation script not found (optional)."
fi

# ─── Stage 3: Semantic Version & Digest Validation ──────────────────
# Validates that all registered rule/skill/requirement/agent files have
# matching SHA-256 digests against rule_registry.json.
#
# Mismatch severity per verification_policy.mismatch_severity_rules:
#   - digest_mismatch_version_bumped  → WARNING (intentional update)
#   - digest_mismatch_version_same    → HIGH    (possible unauthorized mod)
#   - file_missing_registered         → HIGH    (critical file gone)
#
# HIGH severities block execution in strict/locked enforcement mode.

REGISTRY_FILE="${PROJECT_ROOT}/.qoder/state/rule_registry.json"

# ── Digest Check Helper Functions ────────────────────────────────

# Compute SHA-256 digest of a file (raw hex, no prefix).
# Falls back: sha256sum → openssl → python3
compute_sha256() {
  local file="$1"
  if command -v sha256sum &>/dev/null; then
    sha256sum "$file" 2>/dev/null | cut -d' ' -f1
  elif command -v openssl &>/dev/null; then
    openssl dgst -sha256 "$file" 2>/dev/null | awk '{print $NF}'
  elif command -v python3 &>/dev/null; then
    python3 -c "import hashlib; print(hashlib.sha256(open('$file','rb').read()).hexdigest())" 2>/dev/null
  else
    echo ""
  fi
}

# Extract embedded semantic version from a file (mirrors compliance-gate.js extractSemver).
# Patterns: 1) YAML frontmatter: `version: "1.2.3"`  2) Markdown header `# v1.2.3`
#           3) Inline `v1.2.3`
extract_semver() {
  local file="$1"
  [ ! -f "$file" ] && return 1
  local ver=""
  # Pattern 1: YAML frontmatter: `version: "1.2.3"` or `version: 1.2.3`
  ver=$(head -30 "$file" 2>/dev/null | grep -oP '^version:\s*"?\K\d+\.\d+\.\d+' | head -1)
  # Pattern 2: Markdown header: `## Version 1.2.3` or `# v1.2.3`
  [ -z "$ver" ] && ver=$(head -30 "$file" 2>/dev/null | grep -oiP '#{1,3}\s*(?:Version|v)\s*\K\d+\.\d+\.\d+' | head -1)
  # Pattern 3: Inline `v1.2.3`
  [ -z "$ver" ] && ver=$(head -30 "$file" 2>/dev/null | grep -oP 'v\K\d+\.\d+\.\d+' | head -1)
  echo "$ver"
}

# ── Main Digest Validation ───────────────────────────────────────

run_digest_validation() {
  if [ ! -f "$REGISTRY_FILE" ]; then
    echo "  ℹ️  rule_registry.json not found — skipping digest validation."
    return 0
  fi

  if ! command -v jq &>/dev/null; then
    echo "  ⚠️  jq not available — skipping digest validation."
    return 0
  fi

  # Check if we have any hash tool
  local hash_test
  hash_test=$(compute_sha256 "$REGISTRY_FILE" 2>/dev/null || echo "")
  if [ -z "$hash_test" ]; then
    echo "  ⚠️  No hash tool (sha256sum/openssl/python3) — skipping digest validation."
    return 0
  fi

  echo ""
  echo "── Stage 3: Semantic Version & Digest Validation ──────────────"

  local entry_count=$(jq '.entries | length' "$REGISTRY_FILE" 2>/dev/null || echo "0")
  local pass_count=0
  local warn_count=0
  local high_count=0
  local missing_count=0
  local error_entries=""

  while IFS= read -r key; do
    [ -z "$key" ] && continue

    local filepath stored_hash stored_semver
    filepath=$(jq -r --arg k "$key" '.entries[$k].path // ""' "$REGISTRY_FILE" 2>/dev/null || echo "")
    stored_hash=$(jq -r --arg k "$key" '.entries[$k].sha256 // ""' "$REGISTRY_FILE" 2>/dev/null || echo "")
    stored_semver=$(jq -r --arg k "$key" '.entries[$k].semver // ""' "$REGISTRY_FILE" 2>/dev/null || echo "")

    [ -z "$filepath" ] || [ -z "$stored_hash" ] && continue

    local full_path="${PROJECT_ROOT}/${filepath}"

    # Check: file exists?
    if [ ! -f "$full_path" ]; then
      missing_count=$((missing_count + 1))
      error_entries="${error_entries}\n  ❌ MISSING: ${filepath} (registered but file not found)"
      continue
    fi

    # Compute actual digest
    local actual_hash
    actual_hash=$(compute_sha256 "$full_path")

    if [ -z "$actual_hash" ]; then
      high_count=$((high_count + 1))
      error_entries="${error_entries}\n  ❌ READ_ERROR: ${filepath} (cannot compute digest)"
      continue
    fi

    # Digest comparison
    if [ "$actual_hash" = "$stored_hash" ]; then
      # Match → PASS
      pass_count=$((pass_count + 1))
      continue
    fi

    # ═══ Digest Mismatch → determine severity ═══
    local current_semver severity label
    current_semver=$(extract_semver "$full_path")
    severity="HIGH"
    label="❌"

    if [ -n "$current_semver" ] && [ "$current_semver" != "$stored_semver" ]; then
      # Version bump detected → intentional update → WARNING
      severity="WARNING"
      label="⚠️ "
      warn_count=$((warn_count + 1))
    else
      # No version change → possible unauthorized modification → HIGH
      high_count=$((high_count + 1))
    fi

    local stored_short="${stored_hash:0:12}"
    local actual_short="${actual_hash:0:12}"
    local ver_info=""
    [ "$severity" = "WARNING" ] && ver_info=" (version: ${stored_semver} → ${current_semver})"

    error_entries="${error_entries}\n  ${label}${severity}: ${filepath} | stored: ${stored_short}... | actual: ${actual_short}...${ver_info}"
  done < <(jq -r '.entries | keys[]' "$REGISTRY_FILE" 2>/dev/null)

  # ── Summary ──────────────────────────────────────────────────
  local total=$((pass_count + warn_count + high_count + missing_count))
  echo "  Total: ${entry_count} | Checked: ${total} | PASS: ${pass_count} | WARN: ${warn_count} | HIGH: ${high_count} | MISSING: ${missing_count}"

  if [ "$high_count" -gt 0 ] || [ "$missing_count" -gt 0 ]; then
    echo -e "$error_entries"
    echo ""
    enf_exit "Digest validation FAILED: ${high_count} HIGH mismatch(es), ${missing_count} missing file(s). Run 'regenerate rule_registry.json' or investigate unauthorized modifications."
  elif [ "$warn_count" -gt 0 ]; then
    echo -e "$error_entries"
    echo ""
    if [ "$ENF_MODE" = "advisory" ]; then
      echo "  ⚠️  [ADVISORY] ${warn_count} version bump(s) detected (non-blocking)."
    else
      echo "  ⚠️  [${ENF_MODE}] ${warn_count} version bump(s) detected — verify compatibility."
    fi
  else
    local sample_hash=""
    [ "$pass_count" -gt 0 ] && sample_hash=" | sample: ${actual_hash:0:12}..."
    echo "  ✅ All ${pass_count} registered file digests verified${sample_hash}"
  fi

  return 0
}

# Only run digest validation if enforcement is not advisory
# (advisory mode still prints results, but non-blocking via enf_exit)
run_digest_validation

exit 0
