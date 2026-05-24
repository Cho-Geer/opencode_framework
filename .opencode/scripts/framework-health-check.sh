#!/bin/bash
# ===========================================================================
# framework-health-check.sh — OpenCode Framework Health Check One-Liner Wrapper
# ===========================================================================
# Runs 4 framework integrity checks in sequence:
#   1. framework-doctor.js --strict
#   2. framework-self-test.js
#   3. state-reconciliation.js --strict
#   4. rule-registry-verify.js --strict
#
# Usage:
#   bash .opencode/scripts/framework-health-check.sh
#
# Output:
#   Single line: HEALTHY ✅ or UNHEALTHY ❌ with failed step(s)
#
# Exit code:
#   0 — All checks passed
#   1 — One or more checks failed
# ===========================================================================

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"
cd "$ROOT"

FAILED_STEPS=""
STEP_NUM=0

run_step() {
  STEP_NUM=$((STEP_NUM + 1))
  local step_name="$1"
  shift
  local cmd=("$@")

  if "${cmd[@]}" >/dev/null 2>&1; then
    return 0
  else
    if [ -z "$FAILED_STEPS" ]; then
      FAILED_STEPS="$step_name"
    else
      FAILED_STEPS="$FAILED_STEPS, $step_name"
    fi
    return 1
  fi
}

# Step 1: framework-doctor --strict
run_step "framework-doctor" node .opencode/scripts/framework-doctor.js --strict || true

# Step 2: framework-self-test
run_step "framework-self-test" node .opencode/scripts/framework-self-test.js || true

# Step 3: state-reconciliation --strict
run_step "state-reconciliation" node .opencode/scripts/state-reconciliation.js --strict || true

# Step 4: rule-registry-verify --strict
run_step "rule-registry-verify" node .opencode/scripts/rule-registry-verify.js --strict || true

# ── Output ──────────────────────────────────────────────────────
if [ -z "$FAILED_STEPS" ]; then
  echo "HEALTHY ✅"
  exit 0
else
  echo "UNHEALTHY ❌ — failed: $FAILED_STEPS"
  exit 1
fi
