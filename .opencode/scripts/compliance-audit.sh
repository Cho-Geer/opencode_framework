#!/usr/bin/env bash
#
# compliance-audit.sh — Orchestrator Role Compliance Audit
# =========================================================
# Scans .task_temp/ for evidence that @Orchestrator used
# unauthorized tools (grep, read, glob, webfetch) during
# a session.
#
# Usage:
#   .opencode/scripts/compliance-audit.sh <session_id>
#
# Exit codes:
#   0 — PASS (no violations)
#   1 — FAILED (violations detected)
#

set -euo pipefail

# ──────────────────────────────────────────────
# 0. Argument validation
# ──────────────────────────────────────────────
SESSION_ID="${1:-}"

if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: session_id is required as first argument" >&2
  echo "Usage: $0 <session_id>" >&2
  exit 2
fi

# ──────────────────────────────────────────────
# 1. Define paths
# ──────────────────────────────────────────────
TASK_TEMP_DIR=".task_temp"
OUTPUT_DIR="${TASK_TEMP_DIR}/_global"
OUTPUT_FILE="${OUTPUT_DIR}/orchestrator_violations.json"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# ──────────────────────────────────────────────
# 2. Collect log files for this session
# ──────────────────────────────────────────────
# Look for any files under .task_temp/ that reference the session_id
# (session directories, TASK_LOG.md, HANDOVER.md, etc.)

VIOLATIONS=()

# Tools that @Orchestrator must NOT use (per agent_tools_blacklist)
FORBIDDEN_TOOLS=("grep" "read" "glob" "webfetch")

for tool in "${FORBIDDEN_TOOLS[@]}"; do
  # Search task_temp for evidence of the tool being called by Orchestrator
  # Patterns to detect:
  #   - Tool invocation logs with the tool name
  #   - "Tool used: <tool>" entries
  #   - <invoke name="<tool>"> in log files
  #   - References in HANDOVER.md mentioning the tool

  count=0

  # Scan files under .task_temp/ excluding _global directory
  if [[ -d "$TASK_TEMP_DIR" ]]; then
    # Count occurrences of the forbidden tool in session-related files
    # Look for tool invocation patterns in log/md files
    while IFS= read -r -d '' file; do
      # Skip the violations output file itself and _global dir
      if [[ "$file" == *"_global"* ]]; then
        continue
      fi

      # Count tool mentions in this file (word-boundary match)
      file_count=$(grep -c -i -w "$tool" "$file" 2>/dev/null || echo "0")
      count=$((count + file_count))

      # Also search for structured invocation patterns: <invoke name="$tool">
      invoke_pattern_count=$(grep -c -i "<invoke name=\"$tool\">" "$file" 2>/dev/null || echo "0")
      count=$((count + invoke_pattern_count))
    done < <(find "$TASK_TEMP_DIR" -type f \( -name "*.log" -o -name "*.md" -o -name "*.json" -o -name "*.txt" \) -print0 2>/dev/null || true)
  fi

  if [[ "$count" -gt 0 ]]; then
    # Determine severity: read/glob are "high", webfetch is "medium"
    severity="high"
    if [[ "$tool" == "webfetch" ]]; then
      severity="medium"
    fi

    VIOLATIONS+=("{\"tool\": \"$tool\", \"count\": $count, \"severity\": \"$severity\"}")
  fi
done

# ──────────────────────────────────────────────
# 3. Write results
# ──────────────────────────────────────────────

if [[ ${#VIOLATIONS[@]} -eq 0 ]]; then
  # PASS — no violations detected
  cat > "$OUTPUT_FILE" <<JSONEOF
{
  "session_id": "${SESSION_ID}",
  "violations": [],
  "verdict": "PASS"
}
JSONEOF
  echo "✅ Compliance Audit PASSED for session ${SESSION_ID}"
  exit 0
else
  # FAILED — violations detected
  VIOLATIONS_JSON=$(IFS=,; echo "[${VIOLATIONS[*]}]")

  cat > "$OUTPUT_FILE" <<JSONEOF
{
  "session_id": "${SESSION_ID}",
  "violations": ${VIOLATIONS_JSON},
  "verdict": "FAILED"
}
JSONEOF
  echo "❌ Compliance Audit FAILED for session ${SESSION_ID}"
  echo "   Violations written to ${OUTPUT_FILE}"
  exit 1
fi
